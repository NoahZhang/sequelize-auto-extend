var Sequelize = require('sequelize');
var async = require('async');
var fs = require('fs');
var path = require('path');
var mkdirp = require('mkdirp');
var dialects = require('./dialects');
var _ = Sequelize.Utils._;

function AutoSequelize(database, username, password, options) {
  this.sequelize = new Sequelize(database, username, password, options || {});
  this.queryInterface = this.sequelize.getQueryInterface();
  this.tables = {};
  this.foreignKeys = {};
  this.dialect = dialects[this.sequelize.options.dialect];

  this.options = _.extend({
    global: 'Sequelize',
    local: 'sequelize',
    spaces: false,
    indentation: 1,
    directory: './models',
    additional: {},
    freezeTableName: true
  }, options || {});
}

AutoSequelize.prototype.build = function (callback) {
  var self = this;

  function mapTable(table, _callback) {
    self.queryInterface.describeTable(table).then(function (fields) {
      self.tables[table] = fields
      _callback();
    }, _callback);
  }

  this.queryInterface.showAllTables().then(function (__tables) {
    if (self.sequelize.options.dialect === 'mssql')
      __tables = _.map(__tables, 'tableName');

    var tables = self.options.tables ? _.intersection(__tables, self.options.tables) : __tables;

    async.each(tables, mapForeignKeys, mapTables)

    function mapTables(err) {
      if (err) console.error(err)

      async.each(tables, mapTable, callback);
    }
  }, callback);

  function mapForeignKeys(table, fn) {
    if (!self.dialect) return fn()

    var sql = self.dialect.getForeignKeysQuery(table, self.sequelize.config.database)
  
    self.sequelize.query(sql, {
      type: self.sequelize.QueryTypes.SELECT,
      raw: true
    }).then(function (res) {
      _.each(res, assignColumnDetails)
      fn()
    }, fn);

    function assignColumnDetails(ref) {
      // map sqlite's PRAGMA results
      ref = _.mapKeys(ref, function (value, key) {
        switch (key) {
          case 'from':
            return 'source_column';
          case 'to':
            return 'target_column';
          case 'table':
            return 'target_table';
          default:
            return key;
        }
      });

      ref = _.assign({
        source_table: table,
        source_schema: self.sequelize.options.database,
        target_schema: self.sequelize.options.database
      }, ref);

      if (!_.isEmpty(_.trim(ref.source_column)) && !_.isEmpty(_.trim(ref.target_column)))
        ref.isForeignKey = true

      if (_.isFunction(self.dialect.isPrimaryKey) && self.dialect.isPrimaryKey(ref))
        ref.isPrimaryKey = true

      if (_.isFunction(self.dialect.isSerialKey) && self.dialect.isSerialKey(ref))
        ref.isSerialKey = true

      self.foreignKeys[table] = self.foreignKeys[table] || {};
      self.foreignKeys[table][ref.source_column] = _.assign({}, self.foreignKeys[table][ref.source_column], ref);
    }
  }
}

AutoSequelize.prototype.run = function (callback) {
  var self = this;
  var text = {};
  var tables = [];

  if (self.options.model === 'Sequelize') {
    this.build(generateText);
  } else if (self.options.model === 'JSON') {
    this.build(generateJSONSchema);
  } else {
    console.error('Unknown model')
  }

  function generateJSONSchema(err) {
    if (err) console.error(err)

    async.each(_.keys(self.tables), function (table, _callback) {
      var fields = _.keys(self.tables[table])
        , spaces = '', requiredFields = [];

      for (var x = 0; x < self.options.indentation; ++x) {
        spaces += (self.options.spaces === true ? ' ' : "\t");
      }

      text[table] = "{\n";
      text[table] += spaces + '"type": "object",\n';
      text[table] += spaces + '"properties": {\n';
    
      _.each(fields, function (field, i) {
        if (self.options.ignoreFields.indexOf(field) >= 0) {
          return true
        }
        // Find foreign key
        var foreignKey = self.foreignKeys[table] && self.foreignKeys[table][field] ? self.foreignKeys[table][field] : null

        if (_.isObject(foreignKey)) {
          self.tables[table][field].foreignKey = foreignKey
        }

        // column's attributes
        var fieldAttr = _.keys(self.tables[table][field]);
        text[table] += spaces + spaces + '"' + field + '": {\n';

        // Serial key for postgres...
        var defaultVal = self.tables[table][field].defaultValue;

        // ENUMs for postgres...
        if (self.tables[table][field].type === "USER-DEFINED" && !!self.tables[table][field].special) {
          self.tables[table][field].type = "ENUM(" + self.tables[table][field].special.map(function (f) { return "'" + f + "'"; }).join(',') + ")";
        }

        _.each(fieldAttr, function (attr, x) {
          var isSerialKey = self.tables[table][field].foreignKey && _.isFunction(self.dialect.isSerialKey) && self.dialect.isSerialKey(self.tables[table][field].foreignKey)

          // We don't need the special attribute from postgresql describe table..
          if (attr === "special") {
            return true;
          }

          if (attr === "foreignKey") {
            return true;
          }
          else if (attr === "primaryKey") {
            return true
          }
          else if (attr === "allowNull") {
            if (!self.tables[table][field][attr]) {
              requiredFields.push(field)
            }
            //text[table] += spaces + spaces + spaces + attr + ": " + self.tables[table][field][attr];
            return true
          }
          else if (attr === "defaultValue") {
            return true
          }
          else if (attr === "type" && self.tables[table][field][attr].indexOf('ENUM') === 0) {
            text[table] += spaces + spaces + spaces + '"enum": [' + self.tables[table][field][attr].replace('ENUM(', '').replace(')', '').replace(/\'/g, '"') + ']';
          } else { 
            var length = 0;
            var _attr = (self.tables[table][field][attr] || '').toLowerCase();
            var val = "'" + self.tables[table][field][attr] + "'", format = '';
            if (_attr === "tinyint(1)" || _attr === "boolean" || _attr === "bit(1)") {
              val = 'boolean';
            }
            else if (_attr.match(/^(smallint|mediumint|tinyint|int)/)) {
              var length = _attr.match(/\(\d+\)/);
              val = 'integer';
              format = 'int32';
            }
            else if (_attr.match(/^bigint/)) {
              val = 'integer';
              format = 'int64';
            }
            else if (_attr.match(/^string|varchar|varying|nvarchar/)) {
              val = 'string';
              if(_attr.match(/^varchar/)) {
                var matches = _attr.match(/\(\d+\)/)[0];
                if (matches.length > 0) {
                  length = parseInt(matches.replace(/[^0-9]/ig,''))
                }
              }
            }
            else if (_attr.match(/^char/)) {
              var length = _attr.match(/\(\d+\)/);
              val = 'string';
            }
            else if (_attr.match(/text|ntext$/)) {
              val = 'string';
            }
            else if (_attr.match(/^(date)/)) {
              val = 'string';
              format = 'date-time';
            }
            else if (_attr.match(/^(time)/)) {
              val = 'string';
            }
            else if (_attr.match(/^(float|float4)/)) {
              val = 'number';
              format = "float";
            }
            else if (_attr.match(/^decimal/)) {
              val = 'number';
            }
            else if (_attr.match(/^(float8|double precision)/)) {
              val = 'number';
              format = 'double';
            }
            else if (_attr.match(/^uuid|uniqueidentifier/)) {
              val = 'string';
              format = 'uuid'
            }
            else if (_attr.match(/^json/)) {
              val = 'any';
            }
            else if (_attr.match(/^jsonb/)) {
              val = 'any';
            }
            
            text[table] += spaces + spaces + spaces + '"type": "' + val + '"';
            if (format.length > 0) {
              text[table] += ",\n"
              text[table] += spaces + spaces + spaces + '"format": "' + format + '"';
            }
  
            if(!self.tables[table][field]["allowNull"]) {
              if (val === 'string') {
                text[table] += ",\n"
                text[table] += spaces + spaces + spaces + '"minLength": 1';
              }
            }

            if(length > 0) {
              if (val === 'string') {
                text[table] += ",\n"
                text[table] += spaces + spaces + spaces + '"maxLength": ' + length;
              }
            }
          }   

          text[table] += "\n";
          text[table] += spaces + spaces + "},\n"; 
        })
      });
      
      // removes the last `,` within the attribute options
      text[table] = text[table].trim().replace(/,+$/, '') + "\n";

      if (requiredFields.length > 0) {
        text[table] += spaces + "},\n";
        text[table] += spaces + '"required": ' + JSON.stringify(requiredFields) + '\n';
      } else {
        text[table] += spaces + "}\n";
      }

      text[table] += "}";
      _callback(null);
    }, function () {
      self.sequelize.close();
      self.write(text, callback);
    });
  }

  function generateText(err) {
    if (err) console.error(err)

    async.each(_.keys(self.tables), function (table, _callback) {
      var fields = _.keys(self.tables[table])
        , spaces = '';

      for (var x = 0; x < self.options.indentation; ++x) {
        spaces += (self.options.spaces === true ? ' ' : "\t");
      }

      text[table] = "/* jshint indent: " + self.options.indentation + " */\n\n";
      text[table] += "module.exports = function(sequelize, DataTypes) {\n";
      text[table] += spaces + "return sequelize.define('" + table + "', {\n";

      _.each(fields, function (field, i) {
        if (self.options.ignoreFields.indexOf(field) >= 0) {
          return true
        }
        
        // Find foreign key
        var foreignKey = self.foreignKeys[table] && self.foreignKeys[table][field] ? self.foreignKeys[table][field] : null

        if (_.isObject(foreignKey)) {
          self.tables[table][field].foreignKey = foreignKey
        }

        // column's attributes
        var fieldAttr = _.keys(self.tables[table][field]);
        text[table] += spaces + spaces + field + ": {\n";

        // Serial key for postgres...
        var defaultVal = self.tables[table][field].defaultValue;

        // ENUMs for postgres...
        if (self.tables[table][field].type === "USER-DEFINED" && !!self.tables[table][field].special) {
          self.tables[table][field].type = "ENUM(" + self.tables[table][field].special.map(function (f) { return "'" + f + "'"; }).join(',') + ")";
        }

        _.each(fieldAttr, function (attr, x) {
          var isSerialKey = self.tables[table][field].foreignKey && _.isFunction(self.dialect.isSerialKey) && self.dialect.isSerialKey(self.tables[table][field].foreignKey)

          // We don't need the special attribute from postgresql describe table..
          if (attr === "special") {
            return true;
          }

          if (attr === "foreignKey") {
            if (isSerialKey) {
              text[table] += spaces + spaces + spaces + "autoIncrement: true";
            }
            else if (foreignKey.isForeignKey) {
              text[table] += spaces + spaces + spaces + "references: {\n";
              text[table] += spaces + spaces + spaces + spaces + "model: \'" + self.tables[table][field][attr].target_table + "\',\n"
              text[table] += spaces + spaces + spaces + spaces + "key: \'" + self.tables[table][field][attr].target_column + "\'\n"
              text[table] += spaces + spaces + spaces + "}"
            } else return true;
          }
          else if (attr === "primaryKey") {
            if (self.tables[table][field][attr] === true && (!_.has(self.tables[table][field], 'foreignKey') || (_.has(self.tables[table][field], 'foreignKey') && !!self.tables[table][field].foreignKey.isPrimaryKey)))
              text[table] += spaces + spaces + spaces + "primaryKey: true";
            else return true
          }
          else if (attr === "allowNull") {
            text[table] += spaces + spaces + spaces + attr + ": " + self.tables[table][field][attr];
          }
          else if (attr === "defaultValue") {
            if (self.dialect == 'mssql' && defaultVal.toLowerCase() === '(newid())') {
              defaultVal = null; // disable adding "default value" attribute for UUID fields if generating for MS SQL
            }

            var val_text = defaultVal;

            if (isSerialKey) return true

            //mySql Bit fix
            if (self.tables[table][field].type.toLowerCase() === 'bit(1)') {
              val_text = defaultVal === "b'1'" ? 1 : 0;
            }

            if (_.isString(defaultVal)) {
              if (self.tables[table][field].type.toLowerCase().indexOf('date') === 0) {
                if (_.endsWith(defaultVal, '()')) {
                  val_text = "sequelize.fn('" + defaultVal.replace(/\(\)$/, '') + "')"
                }
                else if (_.includes(['current_timestamp', 'current_date', 'current_time', 'localtime', 'localtimestamp'], defaultVal.toLowerCase())) {
                  val_text = "sequelize.literal('" + defaultVal + "')"
                } else {
                  val_text = "'" + val_text + "'"
                }
              } else {
                val_text = "'" + val_text + "'"
              }
            }
            if (defaultVal === null) {
              return true;
            } else {
              text[table] += spaces + spaces + spaces + attr + ": " + val_text;
            }
          }
          else if (attr === "type" && self.tables[table][field][attr].indexOf('ENUM') === 0) {
            text[table] += spaces + spaces + spaces + attr + ": DataTypes." + self.tables[table][field][attr];
          } else {
            var _attr = (self.tables[table][field][attr] || '').toLowerCase();
            var val = "'" + self.tables[table][field][attr] + "'";
            if (_attr === "tinyint(1)" || _attr === "boolean" || _attr === "bit(1)") {
              val = 'DataTypes.BOOLEAN';
            }
            else if (_attr.match(/^(smallint|mediumint|tinyint|int)/)) {
              var length = _attr.match(/\(\d+\)/);
              val = 'DataTypes.INTEGER' + (!_.isNull(length) ? length : '');
            }
            else if (_attr.match(/^bigint/)) {
              val = 'DataTypes.BIGINT';
            }
            else if (_attr.match(/^string|varchar|varying|nvarchar/)) {
              val = 'DataTypes.STRING';
            }
            else if (_attr.match(/^char/)) {
              var length = _attr.match(/\(\d+\)/);
              val = 'DataTypes.CHAR' + (!_.isNull(length) ? length : '');
            }
            else if (_attr.match(/text|ntext$/)) {
              val = 'DataTypes.TEXT';
            }
            else if (_attr.match(/^(date)/)) {
              val = 'DataTypes.DATE';
            }
            else if (_attr.match(/^(time)/)) {
              val = 'DataTypes.TIME';
            }
            else if (_attr.match(/^(float|float4)/)) {
              val = 'DataTypes.FLOAT';
            }
            else if (_attr.match(/^decimal/)) {
              val = 'DataTypes.DECIMAL';
            }
            else if (_attr.match(/^(float8|double precision)/)) {
              val = 'DataTypes.DOUBLE';
            }
            else if (_attr.match(/^uuid|uniqueidentifier/)) {
              val = 'DataTypes.UUIDV4';
            }
            else if (_attr.match(/^json/)) {
              val = 'DataTypes.JSON';
            }
            else if (_attr.match(/^jsonb/)) {
              val = 'DataTypes.JSONB';
            }
            else if (_attr.match(/^geometry/)) {
              val = 'DataTypes.GEOMETRY';
            }
            text[table] += spaces + spaces + spaces + attr + ": " + val;
          }

          text[table] += ",";
          text[table] += "\n";
        });

        // removes the last `,` within the attribute options
        text[table] = text[table].trim().replace(/,+$/, '') + "\n";

        text[table] += spaces + spaces + "}";
        if ((i + 1) < fields.length) {
          text[table] += ",";
        }
        text[table] += "\n";
      });

      text[table] += spaces + "}";

      //conditionally add additional options to tag on to orm objects
      var hasadditional = _.isObject(self.options.additional) && _.keys(self.options.additional).length > 0;

      text[table] += ", {\n";

      text[table] += spaces + spaces + "tableName: '" + table + "',\n";

      if (hasadditional) {
        _.each(self.options.additional, addAdditionalOption)
      }

      text[table] = text[table].trim()
      text[table] = text[table].substring(0, text[table].length - 1);
      text[table] += "\n" + spaces + "}";

      function addAdditionalOption(value, key) {
        if (key === 'name') {
          // name: true - preserve table name always
          text[table] += spaces + spaces + "name: {\n";
          text[table] += spaces + spaces + spaces + "singular" + ": '" + table + "',\n";
          text[table] += spaces + spaces + spaces + "plural" + ": '" + table + "'\n";
          text[table] += spaces + spaces + "},\n";
        }
        else {
          text[table] += spaces + spaces + key + ": " + value + ",\n";
        }
      }

      //resume normal output
      text[table] += ");\n};\n";
      _callback(null);
    }, function () {
      self.sequelize.close();
      self.write(text, callback);
    });
  }

}

AutoSequelize.prototype.write = function (attributes, callback) {
  var tables = _.keys(attributes);
  var self = this;
  var suffix = '.js';

  if (self.options.model === 'JSON') {
    suffix = '.json'
  }

  mkdirp.sync(path.resolve(self.options.directory))

  async.each(tables, createFile, callback)

  function createFile(table, _callback) {
    fs.writeFile(path.resolve(path.join(self.options.directory, table + suffix)), attributes[table], _callback);
  }
}

module.exports = AutoSequelize