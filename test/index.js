process.env.NODE_ENV = 'testing';
var BaseModel = require("../index");
var expect = require("expect.js");
var ObjectID = require("mongodb").ObjectID;
var difflet = require('difflet');
var deepEqual = require('deep-equal');
var traverse = require('traverse');
var assert = require('assert');
var MongoClient = require('mongodb').MongoClient;
var Server = require('mongodb').Server;
var _ = require('lodash');

var failOnError = function(err){
  if (err){
    console.error("");
    console.error("unexpected error: ", (err.message || err));
    console.error(err);
    console.error(new Error().stack);
    console.error("");
    throw "unexpected error: " + JSON.stringify((err.message || err));
  }
};

var assertObjectEquals = function(actual, expected, options){
  if (options && options.unordered) {
    actual = actual.map(JSON.stringify).sort().map(JSON.parse);
    expected = expected.map(JSON.stringify).sort().map(JSON.parse);
  }

  // strip the milliseconds off all dates
  traverse(expected).forEach(function (x) {
    if (_.isDate(x)) {
      x.setMilliseconds(0);
      this.update(x);
    }
  });
  // strip the milliseconds off all dates
  traverse(actual).forEach(function (x) {
    if (_.isDate(x)) {
      x.setMilliseconds(0);
      this.update(x);
    }
  });
  if (!deepEqual(actual, expected)){
    process.stdout.write(difflet.compare(actual, expected));
    console.log("\n\nactual");
    console.log(JSON.stringify(actual, null, 2));
    console.log("\n\nexpected");
    console.log(JSON.stringify(expected, null, 2));
    console.log("\n\n");
    assert.fail(actual, expected);
    return false;
  }
  return true;
};

// old-style validator schema
var schema = {
  $name: "fakeusers",
  _id: {
    $special: "oid",
    $validate: BaseModel.oidTest("_id")
  },
  firstName: {
    $type: 'string',
    $required: true
  },
  lastName: 'string'
};

// new-style json Schema
var jsonSchema = {
  firstName: {
    type: "string",
    required: true
  },
  lastName: {
    type: "string"
  }
};

describe("BaseModel", function() {
  var student;
  var testcollection = "students";
  var db;
  var model;

  var collection = function() {
    return db.collection('fakeusers');
  };

  var dropCollection = function(cb) {
    if(collection()) {
      collection().drop(cb);
    } else {
      cb();
    }
  };

  before(function(done) {
    // Set up the connection to the local db
    var mongoclient = new MongoClient(
        new Server("localhost", 27017), {native_parser: true}
    );
    // Open the connection to the server
    mongoclient.open(function(err, mongoclient) {

      // Get the first db and do an update document on it
      db = mongoclient.db("tests");
      collection().drop(function(err){
        model = new BaseModel('fakeusers', schema, db);
        done();
      });
    });
  });

  it("requires a collectionName", function() {
    try {
      model = new BaseModel();
    } catch (err) {
      expect(err.message).to.be("collectionName cannot be null");
    }
  });

  describe("indices", function() {

    it("ensures index on the provided fields", function(done) {
      var indices = [
        { firstName: 1 }
      ];
      model.indices(indices);

      // Ensure indices is asynchronous.
      setTimeout(function() {
        collection().indexInformation(function(err, info) {
          failOnError(err);
          var expected = { _id_: [ [ '_id', 1 ] ],
                           firstName_1: [ [ 'firstName', 1 ] ]};
          assertObjectEquals(info, expected);
          done();
        });
      }, 300);
    });

    it("ensures index on the provided fields (with options)", function(done) {
      var indices = [
        {
          index: { lastName: -1 },
          options: { sparse: true, unique: true }
        }
      ];
      model.indices(indices);

      // Ensure indices is asynchronous.
      setTimeout(function() {
        collection().indexInformation(function(err, info) {
          failOnError(err);
          var expected = {
            _id_:         [ [ '_id', 1 ] ],
            firstName_1:  [ [ 'firstName', 1 ] ],
           'lastName_-1': [ [ 'lastName', -1 ] ]
          };
          assertObjectEquals(info, expected);
          done();
        });
      }, 300);
    });

  });

  describe("#create (with old Validator schema)", function() {

    describe("one document", function() {
      after(function(done) {
        dropCollection(done);
      });

      it("should create the document in the database", function(done) {
        var newDoc = {
          firstName: "class",
          lastName: "dojo"
        };
        model.create(newDoc, function(err, doc) {
          expect(err).to.be(null);
          //let's check the database
          collection().find({firstName: "class"}).toArray(function(err, docs) {
            process.nextTick(function() {
              expect(docs).to.have.length(1);
              done();
            });
          });
        });
      });

      it("should require all required fields", function(done) {
        var newDoc = {
          lastName: "dojo"
        };
        model.create(newDoc, function(err, doc) {
          expect(err).to.be.an(Error);
          expect(err.message).to.be("firstName must be present");
          done();
        });
      });
    });

    describe("an array of documents", function() {

      it("should properly create an array of documents", function(done) {
        var newDoc1 = {
          firstName: "class"
        };
        var newDoc2 = {
          firstName: "dojo"
        };
        model.create([newDoc1, newDoc2], function(err, docs) {
          expect(err).to.be(null);
          expect(docs).to.have.length(2);
          collection().find().toArray(function(err, docs) {
            process.nextTick(function() {
              expect(docs).to.have.length(2);
              dropCollection(done);
            });
          });
        });
      });

      it("should not save anything if one document fails validation", function(done) {
        var newDoc1 = {
          firstName: "class"
        };
        var badDoc = {
          lastName: "bad"
        };
        model.create([newDoc1, badDoc], function(err, docs) {
          expect(err).to.be.an(Error);
          expect(arguments).to.have.length(1);
          collection().find().toArray(function(err, docs) {
            process.nextTick(function() {
              expect(docs).to.have.length(0);
              done(err);
            });
          });
        });
      });
    });
  });

  describe("#create (with new JSON schema)", function() {

    var oldModel;

    before(function() {
      oldModel = model;
      model = new BaseModel('fakeusers');
      model.database(db);
      model.schema(jsonSchema);
    });

    describe("one document", function() {
      after(function(done) {
        dropCollection(done);
      });

      it("should create the document in the database", function(done) {
        var newDoc = {
          firstName: "class",
          lastName: "dojo"
        };
        model.create(newDoc, function(err, doc) {
          expect(err).to.be(null);
          //let's check the database
          collection().find({firstName: "class"}).toArray(function(err, docs) {
            process.nextTick(function() {
              expect(docs).to.have.length(1);
              done();
            });
          });
        });
      });

      it("should require all required fields", function(done) {
        var newDoc = {
          lastName: "dojo"
        };
        model.create(newDoc, function(err, doc) {
          expect(err).to.be.an(Error);
          expect(err.errors[0].message).to.be("Property is required");
          done();
        });
      });
    });

    describe("an array of documents", function() {

      it("should properly create an array of documents", function(done) {
        var newDoc1 = {
          firstName: "class"
        };
        var newDoc2 = {
          firstName: "dojo"
        };
        model.create([newDoc1, newDoc2], function(err, docs) {
          expect(err).to.be(null);
          expect(docs).to.have.length(2);
          collection().find().toArray(function(err, docs) {
            process.nextTick(function() {
              expect(docs).to.have.length(2);
              dropCollection(done);
            });
          });
        });
      });

      it("should not save anything if one document fails validation", function(done) {
        var newDoc1 = {
          firstName: "class"
        };
        var badDoc = {
          lastName: "bad"
        };
        model.create([newDoc1, badDoc], function(err, docs) {
          expect(err).to.be.an(Error);
          expect(arguments).to.have.length(1);
          collection().find().toArray(function(err, docs) {
            process.nextTick(function() {
              expect(docs).to.have.length(0);
              done(err);
            });
          });
        });
      });
    });
    after(function() {
      model = oldModel;
    });
  });

  describe("#update (with old Validator schema)", function() {

    beforeEach(function(done) {
      //insert a document to do updates
      var doc = {
        _id: ObjectID("52535efb0555c1353a75f54b"),//explicit _id set
        firstName: "class",
        lastName: "dojo"
      };
      collection().insert(doc, done);
    });

    afterEach(function(done) {
      dropCollection(done);
    });

    it("should create an error when an _id is not passed in", function(done) {
      var updateDoc = {
        firstName: "class"
      };
      model.update(updateDoc, function(err, doc) {
        expect(err).to.be.an(Error);
        expect(err.message).to.contain("_id");
        done();
      });
    });

    it("should create an error when an _id is not valid", function(done) {
      var updateDoc = {
        _id: "notValid"
      };
      model.update(updateDoc, function(err, doc) {
        expect(err.message).to.equal("Must provide a valid MongoId for `_id`");
        done();
      });
    });
    it("should update a document when at least one schema field is passed in", function(done) {
      var updateDoc = {
        _id: "52535efb0555c1353a75f54b",
        firstName: "school"
      };
      model.update(updateDoc, function(err, doc) {
        expect(err).to.be(null);
        expect(doc).to.have.property("firstName", "school");
        done();
      });
    });

    it("should allow a non-required field to be updated", function(done) {
      var updateDoc = {
        _id: "52535efb0555c1353a75f54b",
        lastName: "dodo"
      };
      model.update(updateDoc, function(err, doc) {
        expect(err).to.be(null);
        expect(doc).to.have.property("lastName", "dodo");
        done();
      });
    });

    it("should not update the document when a field not defined in the schema is passed in", function(done) {
      var updateDoc = {
        _id: "52535efb0555c1353a75f54b",
        nonField: "aValue"
      };
      model.update(updateDoc, function(err, doc) {
        expect(err).to.be(null);
        expect(doc).to.have.property("firstName", "class");
        expect(doc).to.have.property("lastName", "dojo");
        expect(doc.nonField).to.be(undefined);
        done();
      });
    });

  });

  describe("#update (with new JSON schema)", function() {

    var oldModel;

    beforeEach(function(done) {
      oldModel = model;
      model = new BaseModel('fakeusers');
      model.schema(jsonSchema);
      model.database(db);
      //insert documents to do updates
      var doc1 = {
        _id: ObjectID("52535efb0555c1353a75f54b"),//explicit _id set
        firstName: "class",
        lastName: "dojo"
      };
      var doc2 = {
        _id: ObjectID("52535efb0555c1353a75f54c"),//explicit _id set
        firstName: "crass",
        lastName: "mojo"
      }; 
      collection().insert([doc1, doc2], done);
    });

    afterEach(function(done) {
      model = oldModel;
      dropCollection(done);
    });

    it("creates an error when an _id is not passed in", function(done) {
      var updateDoc = {
        firstName: "class"
      };
      model.update(updateDoc, function(err, doc) {
        expect(err).to.be.an(Error);
        expect(err.message).to.contain("_id");
        done();
      });
    });

    it("should update a document when at least one schema field is passed in", function(done) {
      var updateDoc = {
        _id: "52535efb0555c1353a75f54b",
        firstName: "school"
      };
      model.update(updateDoc, function(err, doc) {
        expect(err).to.be(null);
        expect(doc).to.have.property("firstName", "school");
        expect(doc).to.have.property("lastName", "dojo");
        done();
      });
    });

    it("should allow a non-required field to be updated", function(done) {
      var updateDoc = {
        _id: "52535efb0555c1353a75f54b",
        lastName: "dodo"
      };
      model.update(updateDoc, function(err, doc) {
        expect(err).to.be(null);
        expect(doc).to.have.property("lastName", "dodo");
        done();
      });
    });

    it("should not update the document when a field not defined in the schema is passed in", function(done) {
      var updateDoc = {
        _id: "52535efb0555c1353a75f54b",
        nonField: "aValue"
      };
      model.update(updateDoc, function(err) {
        expect(err.errors[0].message).to.be("Additional properties are not allowed");
        model.findById(updateDoc._id, function(err, doc) {
          expect(err).to.be(null);
          expect(doc).to.have.property("firstName", "class");
          expect(doc).to.have.property("lastName", "dojo");
          expect(doc.nonField).to.be(undefined);
          done();
        });
      });
    });
  });

  describe("updateByIds", function(done) {
    var oldModel;

    beforeEach(function(done) {
      oldModel = model;
      model = new BaseModel('fakeusers');
      model.schema(jsonSchema);
      model.database(db);
      // Documents to update.
      var docs = [
        {
          _id: ObjectID("52535efb0555c1353a75f54b"),//explicit _id set
          firstName: "class",
          lastName: "dojo"
        },
        {
          _id: ObjectID("52535efb0555c1353a75f54c"),
          firstName: "class",
          lastName: "doge-o"
        },
        {
          _id: ObjectID("52535efb0555c1353a75f54d"),
          firstName: "brass",
          lastName: "monkey"
        },
      ];
      collection().insert(docs, done);
    });

    afterEach(function(done) {
      model = oldModel;
      dropCollection(done);
    });

    it("should update docs that match an id selector", function(done) {
      var ids = ["52535efb0555c1353a75f54b", "52535efb0555c1353a75f54c"];
      var toUpdate = {firstName: "bass"};
      model.updateByIds(ids, toUpdate, function(err, result) {
        failOnError(err);
        model.findById(ObjectID("52535efb0555c1353a75f54b"), function(err, item1) {
          failOnError(err);
          expect(item1.firstName).to.equal("bass");
          model.findById(ObjectID("52535efb0555c1353a75f54c"), function(err, item2) {
            failOnError(err);
            expect(item2.firstName).to.equal("bass");
            model.findById(ObjectID("52535efb0555c1353a75f54d"), function(err, item3) {
              failOnError(err);
              expect(item3.firstName).to.equal("brass");
              done();
            });
          });
        });
      });
    });
  });

  describe("#updateWithSelector", function(done) {
    var oldModel;

    beforeEach(function(done) {
      oldModel = model;
      model = new BaseModel('fakeusers');
      model.schema(jsonSchema);
      model.database(db);
      // Documents to update.
      var docs = [
        {
          _id: ObjectID("52535efb0555c1353a75f54b"),//explicit _id set
          firstName: "class",
          lastName: "dojo"
        },
        {
          _id: ObjectID("52535efb0555c1353a75f54c"),
          firstName: "class",
          lastName: "doge-o"
        },
        {
          _id: ObjectID("52535efb0555c1353a75f54d"),
          firstName: "brass",
          lastName: "monkey"
        },
      ];
      collection().insert(docs, done);
    });

    afterEach(function(done) {
      model = oldModel;
      dropCollection(done);
    });

    it("should update docs that match an id selector", function(done) {
      var selector = {_id: {"$in": [ObjectID("52535efb0555c1353a75f54b"), ObjectID("52535efb0555c1353a75f54c")]}};
      var toUpdate = {firstName: "bass"};
      model.updateWithSelector(selector, toUpdate, function(err, result) {
        failOnError(err);
        model.findById(ObjectID("52535efb0555c1353a75f54b"), function(err, item1) {
          failOnError(err);
          expect(item1.firstName).to.equal("bass");
          model.findById(ObjectID("52535efb0555c1353a75f54c"), function(err, item2) {
            failOnError(err);
            expect(item2.firstName).to.equal("bass");
            model.findById(ObjectID("52535efb0555c1353a75f54d"), function(err, item3) {
              failOnError(err);
              expect(item3.firstName).to.equal("brass");
              done();
            });
          });
        });
      });
    });

    it("should update docs that match another selector", function(done) {
      var selector = {firstName: "class"};
      var toUpdate = {firstName: "bass"};
      model.updateWithSelector(selector, toUpdate, function(err, result) {
        failOnError(err);
        model.findById(ObjectID("52535efb0555c1353a75f54b"), function(err, item1) {
          failOnError(err);
          expect(item1.firstName).to.equal("bass");
          model.findById(ObjectID("52535efb0555c1353a75f54c"), function(err, item2) {
            failOnError(err);
            expect(item2.firstName).to.equal("bass");
            model.findById(ObjectID("52535efb0555c1353a75f54d"), function(err, item3) {
              failOnError(err);
              expect(item3.firstName).to.equal("brass");
              done();
            });
          });
        });
      });
    });
  });

  describe("#findById (with old-style schemas)", function() {
    before(function(done) {
      var doc = {
        _id: ObjectID("52535efb0555c1353a75f54b"),//explicit _id set
        firstName: "class",
        lastName: "dojo"
      };
      collection().insert(doc, done);
    });

    after(function(done) {
      dropCollection(done);
    });

    it("can find by string id", function(done) {
      model.findById("52535efb0555c1353a75f54b", function(err, doc) {
        failOnError(err);
        var expected = {"_id" : ObjectID('52535efb0555c1353a75f54b'),
                        "firstName":"class",
                        "lastName":"dojo"};
        assertObjectEquals(doc, expected);
        done();
      });
    });
    it("can find by object id", function(done) {
      model.findById(ObjectID("52535efb0555c1353a75f54b"), function(err, doc) {
        failOnError(err);
        var expected = {"_id" : ObjectID('52535efb0555c1353a75f54b'),
                        "firstName":"class",
                        "lastName":"dojo"};
        assertObjectEquals(doc, expected);
        done();
      });
    });
  });

  describe("#findById (with new-style schemas)", function() {
    var oldModel;

    before(function(done) {
      oldModel = model;
      model = new BaseModel('fakeusers');
      model.schema(jsonSchema);
      model.database(db);
      var doc = {
        _id: ObjectID("52535efb0555c1353a75f54b"),//explicit _id set
        firstName: "class",
        lastName: "dojo"
      };
      collection().insert(doc, done);
    });

    after(function(done) {
      model = oldModel;
      dropCollection(done);
    });

    it("can find by string id", function(done) {
      model.findById("52535efb0555c1353a75f54b", function(err, doc) {
        failOnError(err);
        var expected = {"_id" : '52535efb0555c1353a75f54b',
                        "firstName":"class",
                        "lastName":"dojo"};
        assertObjectEquals(doc, expected);
        done();
      });
    });
    it("can find by object id", function(done) {
      model.findById(ObjectID("52535efb0555c1353a75f54b"), function(err, doc) {
        failOnError(err);
        var expected = {"_id" : '52535efb0555c1353a75f54b',
                        "firstName":"class",
                        "lastName":"dojo"};
        assertObjectEquals(doc, expected);
        done();
      });
    });
  });

  describe("#outputFormatter", function() {
    beforeEach(function(done) {
      oldModel = model;
      model = new BaseModel('fakeusers');
      model.database(db);
      var doc1 = {
        _id: ObjectID("52535efb0555c1353a75f57e"),
        firstName: "class",
        lastName: "dojo",
        blah : true
      };
      var doc2 = {
        _id: ObjectID("52535efb0555c1353a75f55c"),
        firstName: "teacher's",
        lastName: "pet",
        blah : true

      };
      var doc3 = {
        _id: ObjectID("52535efb0555c1353a75f56d"),
        firstName: "highly",
        lastName: "suspicious",
        blah : false
      };
      collection().insert([doc1, doc2, doc3], done);
    });
    afterEach(function(done) {
      model = oldModel;
      dropCollection(done);
    });

    it("returns formatted output for findOne", function(done){
      model.outputFormatter(function(obj){
        return {
          _id : obj._id,
          firstName : obj.firstName,
          lastName : obj.lastName,
          fullName : obj.firstName + ' ' + obj.lastName
        };
      });
      model.findOne({ firstName : 'class'}, function(err, parents) {
        failOnError(err);
        var expected = {
          _id: ObjectID("52535efb0555c1353a75f57e"),//explicit _id set
          firstName: "class",
          lastName: "dojo",
          fullName : "class dojo"
        };
        assertObjectEquals(parents, expected);
        done();
      });
    });
    it("returns formatted output for findById", function(done){
      model.outputFormatter(function(obj){
        return {
          _id : obj._id,
          firstName : obj.firstName,
          lastName : obj.lastName,
          fullName : obj.firstName + ' ' + obj.lastName
        };
      });
      model.findById('52535efb0555c1353a75f57e', function(err, parents) {
        failOnError(err);
        var expected = {
          _id: ObjectID("52535efb0555c1353a75f57e"),//explicit _id set
          firstName: "class",
          lastName: "dojo",
          fullName : "class dojo"
        };
        assertObjectEquals(parents, expected);
        done();
      });
    });
    it("returns formatted output for find", function(done){
      model.outputFormatter(function(obj){
        return {
          _id : obj._id,
          firstName : obj.firstName,
          lastName : obj.lastName,
          fullName : obj.firstName + ' ' + obj.lastName
        };
      });
      model.find({ blah : true }, function(err, parents) {
        failOnError(err);
        var expected = [
          {
            _id: ObjectID("52535efb0555c1353a75f57e"),//explicit _id set
            firstName: "class",
            lastName: "dojo",
            fullName : "class dojo"
          },
          {
            _id: ObjectID("52535efb0555c1353a75f55c"),//explicit _id set
            firstName: "teacher's",
            lastName: "pet",
            fullName : "teacher's pet"
          },
        ];
        assertObjectEquals(parents, expected);
        done();
      });
    });
    it("returns formatted output for findByIds", function(done){
      model.outputFormatter(function(obj){
        return {
          _id : obj._id,
          firstName : obj.firstName,
          lastName : obj.lastName,
          fullName : obj.firstName + ' ' + obj.lastName
        };
      });
      model.findByIds(['52535efb0555c1353a75f57e', '52535efb0555c1353a75f55c'], function(err, parents) {
        failOnError(err);
        var expected = [
          {
            _id: ObjectID("52535efb0555c1353a75f55c"),//explicit _id set
            firstName: "teacher's",
            lastName: "pet",
            fullName : "teacher's pet"
          },
          {
            _id: ObjectID("52535efb0555c1353a75f57e"),//explicit _id set
            firstName: "class",
            lastName: "dojo",
            fullName : "class dojo"
          }
        ];
        assertObjectEquals(parents, expected);
        done();
      });
    });
  });
  describe("#findByIds", function() {
    before(function(done) {
      var doc1 = {
        _id: ObjectID("52535efb0555c1353a75f57e"),
        firstName: "class",
        lastName: "dojo"
      };
      var doc2 = {
        _id: ObjectID("52535efb0555c1353a75f55c"),
        firstName: "teacher's",
        lastName: "pet"
      };
      var doc3 = {
        _id: ObjectID("52535efb0555c1353a75f56d"),
        firstName: "highly",
        lastName: "suspicious"
      };
      collection().insert([doc1, doc2, doc3], done);
    });
    after(function(done) {
      dropCollection(done);
    });

    it("returns matching ids", function(done){
      model.findByIds(['52535efb0555c1353a75f57e', '52535efb0555c1353a75f55c'], function(err, parents) {
        failOnError(err);
        var expected = [
          {
            _id: ObjectID("52535efb0555c1353a75f55c"),//explicit _id set
            firstName: "teacher's",
            lastName: "pet"
          },
          {
            _id: ObjectID("52535efb0555c1353a75f57e"),//explicit _id set
            firstName: "class",
            lastName: "dojo"
          }
        ];
        assertObjectEquals(parents, expected);
        done();
      });
    });
  });
  
  describe("#unsetField", function() {
    var id = ObjectID("52535efb0555c1353a75f54b");
    beforeEach(function(done) {
      var doc = {
        _id: id,//explicit _id set
        firstName: "class",
        lastName: "dojo"
      };
      collection().insert(doc, done);
    });
    afterEach(function(done) {
      dropCollection(done);
    });
    it("should error if an invalid `id` is passed in", function(done) {
      model.unsetField("badId", "firstName", function(err) {
        expect(err).to.be.an(Error);
        expect(err.message).to.contain("Invalid");
        done();
      });
    });

    it("should unset the field", function(done) {
      model.unsetField("52535efb0555c1353a75f54b", "firstName", function(err) {
        failOnError(err);
        collection().findOne({_id: id}, function(err, doc) {
          failOnError(err);
          expect(!!doc.firstName).to.be(false);
          done();
        });
      });
    });

    it("should leave the other fields unmodified", function(done) {
      model.unsetField("52535efb0555c1353a75f54b", "firstName", function(err) {
        failOnError(err);
        collection().findOne({_id: id}, function(err, doc) {
          failOnError(err);
          expect(doc).to.have.property("lastName", "dojo");
          done();
        });
      });
    });
  });

  describe("#find", function() {
    before(function(done) {
      var doc = {
        _id: ObjectID("52535efb0555c1353a75f54b"),//explicit _id set
        firstName: "class",
        lastName: "dojo"
      };
      collection().insert(doc, done);
    });

    after(function(done) {
      dropCollection(done);
    });

    it("should return an array of documents if they're present in the database", function(done) {
      model.find({_id: "52535efb0555c1353a75f54b"}, function(err, docs) {
        expect(err).to.be(null);
        expect(docs).to.be.an(Array);
        expect(docs).to.have.length(1);
        done();
      });
    });

    it("should not return a document if it is not present in the database", function(done) {
      model.find({_id: "52535efb0555c1353a750000"}, function(err, docs) {
        expect(err).to.be(null);
        expect(docs).to.be.an(Array);
        expect(docs).to.have.length(0);
        done();
      });
    });

    it("should return only one document for findOne", function(done) {
      model.findOne({_id: "52535efb0555c1353a75f54b"}, function(err, doc) {
        expect(err).to.be(null);
        expect(doc).to.have.property('firstName', 'class');
        done();
      });
    });

    it("should allow mongodb options to be passed in", function(done) {
      model.find({_id: "52535efb0555c1353a75f54b"}, {fields: ["_id"]}, function(err, doc) {
        expect(err).to.be(null);
        expect(Object.keys(doc)).to.have.length(1);
        done();
      });
    });
  });

  describe("#isObjectID", function() {
    it("returns false for null object ids", function(){
      expect(model.isObjectID()).to.equal(false);
    });
    it("returns false for bad object ids", function(){
      expect(model.isObjectID('1234123412341234')).to.equal(false);
    });
    it("returns true for good object ids", function(){
      expect(model.isObjectID('521fc86d178a92165200001d')).to.equal(true);
    });
  });
  describe("#ObjectID", function() {
    it("converts a string to an object id", function(){
      var actual = model.ObjectID('521fc86d178a92165200001d');
      expect(actual).to.eql(ObjectID('521fc86d178a92165200001d'));
    });
    it("returns an object id if input is an object id", function(){
      var oid = ObjectID('521fc86d178a92165200001d');
      expect(model.ObjectID(oid)).to.eql(ObjectID('521fc86d178a92165200001d'));
    });
  });
  describe("#remove", function() {
    before(function(done) {
      var doc1 = {
        _id: ObjectID("52535efb0555c1353a75f54b"),//explicit _id set
        firstName: "class",
        lastName: "one"
      };
      var doc2 = {
        _id: ObjectID("52535efb0555c1353a75f000"),//explicit _id set
        firstName: "class",
        lastName: "two"
      };
      collection().insert([doc1, doc2], done);
    });

    after(function(done) {
      dropCollection(done);
    });

    it("should not remove any documents on a malformed query", function(done) {
      model.remove({_id: "Hello"}, function(err) {
        expect(err).to.be.an(Error);
        collection().find().toArray(function(err, docs) {
          expect(err).to.be(null);
          expect(docs).to.have.length(2);
          done();
        });
      });
    });

    it("should not remove any documents on a query that has no hits", function(done) {
      model.remove({lastName: "doesNotExist"}, function(err) {
        expect(err).to.be(null);
        collection().find().toArray(function(err, docs) {
          expect(err).to.be(null);
          expect(docs).to.have.length(2);
          done();
        });
      });
    });

    it("should remove a matching document", function(done) {
      model.remove({_id: "52535efb0555c1353a75f54b"}, function(err) {
        expect(err).to.be(null);
        collection().find().toArray(function(err, docs) {
          expect(err).to.be(null);
          expect(docs).to.have.length(1);
          expect(docs[0]).to.have.property("lastName", "two");
          done();
        });
      });
    });
  });
});
