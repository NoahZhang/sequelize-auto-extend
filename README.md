# Sequelize-Auto-Extend

Automatically generate models for [SequelizeJS](https://github.com/sequelize/sequelize) or generate JSON Schema via the command line.Based on [sequelize-auto](https://github.com/sequelize/sequelize-auto).

## Install

   This is only a extend to sequelize-auto.Please download source code.  

## Prerequisites

Download source code and execute `npm install`.

## Usage

    [node] sequelize-auto -h <host> -d <database> -u <user> -x [password] -p [port]  --dialect [dialect] -c [/path/to/config] -o [/path/to/models] -t [tableName] -m [Sequelize|JSON] -i [fields]

    Options:
      -h, --host        IP/Hostname for the database.   [required]
      -d, --database    Database name.                  [required]
      -u, --user        Username for database.
      -x, --pass        Password for database.
      -p, --port        Port number for database.
      -c, --config      JSON file for Sequelize's constructor "options" flag object as defined here: https://sequelize.readthedocs.org/en/latest/api/sequelize/
      -o, --output      What directory to place the models.
      -e, --dialect     The dialect/engine that you're using: postgres, mysql, sqlite
      -a, --additional  Path to a json file containing model definitions (for all tables) which are to be defined within a model's configuration parameter. For more info: https://sequelize.readthedocs.org/en/latest/docs/models-definition/#configuration
      -t, --tables      Comma-separated names of tables to import
      -m, --model       Sequelize or JSON, Sequelize is sequelize model, JSON is JSON Schema, default is Sequelize
      -i, --ignore      Comma-separated names of fields be ignored


## Example

    sequelize-auto -o "./models" -d sequelize_auto_test -h localhost -u my_username -p 5432 -x my_password -e postgres

Produces a file/files such as ./models/Users.js which looks like:

    /* jshint indent: 2 */

    module.exports = function(sequelize, DataTypes) {
      return sequelize.define('Users', {
        id: {
          type: DataTypes.INTEGER(11),
          allowNull: false,
          primaryKey: true,
          autoIncrement: true
        },
        username: {
          type: DataTypes.STRING,
          allowNull: true
        },
        touchedAt: {
          type: DataTypes.DATE,
          allowNull: true
        },
        aNumber: {
          type: DataTypes.INTEGER(11),
          allowNull: true
        },
        bNumber: {
          type: DataTypes.INTEGER(11),
          allowNull: true
        },
        validateTest: {
          type: DataTypes.INTEGER(11),
          allowNull: true
        },
        validateCustom: {
          type: DataTypes.STRING,
          allowNull: false
        },
        dateAllowNullTrue: {
          type: DataTypes.DATE,
          allowNull: true
        },
        defaultValueBoolean: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: '1'
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false
        }
      }, {
        tableName: 'Users',
        freezeTableName: true
      });
    };

Which makes it easy for you to simply [Sequelize.import](http://docs.sequelizejs.com/en/latest/docs/models-definition/#import) it.

Produce a JSON Schema file such as ./schemas/user.json which looks like:

    {
      "type": "object",
      "properties": {
        "id": {
          "type": "integer",
          "format": "int32"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 30
        },
        "avatar": {
          "type": "string",
          "maxLength": 255
        },
        "email": {
          "type": "string",
          "maxLength": 100
        },
        "language": {
          "type": "string",
          "maxLength": 30
        },
        "qq": {
          "type": "string",
          "maxLength": 20
        },
        "wechat": {
          "type": "string",
          "maxLength": 30
        },
        "password": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32
        },
        "salt": {
          "type": "string",
          "minLength": 1,
          "maxLength": 20
        },
        "role": {
          "enum": ["admin","member"]
        },
        "status": {
          "enum": ["disabled","enabled"]
        },
        "isDelete": {
          "enum": ["yes","no"]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "minLength": 1
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time",
          "minLength": 1
        }
      },
      "required": ["id","name","password","salt","role","status","isDelete","createdAt","updatedAt"]
    }

## Configuration options

For the `-c, --config` option the following JSON/configuration parameters are defined by Sequelize's `options` flag within the constructor. For more info:

[https://sequelize.readthedocs.org/en/latest/api/sequelize/](https://sequelize.readthedocs.org/en/latest/api/sequelize/)

## Programmatic API

```js
var SequelizeAuto = require('sequelize-auto')
var auto = new SequelizeAuto('database', 'user', 'pass');

auto.run(function (err) {
  if (err) throw err;

  console.log(auto.tables); // table list
  console.log(auto.foreignKeys); // foreign key list
});
```

## Testing

You must setup a database called `sequelize_auto_test` first, edit the `test/config.js` file accordingly, and then enter in any of the following:

    # for all
    npm run test

    # mysql only
    npm run test-mysql

    # postgres only
    npm run test-postgres

    # postgres native only
    npm run test-postgres-native

    # sqlite only
    npm run test-sqlite
