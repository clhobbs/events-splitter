const { expect } = require('chai');

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const Docker = require('dockerode');
const docker = new Docker();

const sqlite3 = require('sqlite3').verbose();
let db = new sqlite3.Database('./test/events.db');

const defaultTimeOut = 30000;       // default max time allowed for tests and hooks
const extendedTimeOut = 120000;     // for long-running tests or hooks

const testreportFolder = path.join(__dirname, '../testreport');

const agentFile = path.join(__dirname, '../agent/inputs/large_1M_events.log');
const target1File = path.join(__dirname, '../testreport/target1_events.log');
const target2File = path.join(__dirname, '../testreport/target2_events.log');

let agentEvents;
let target1Events;
let target2Events;

/**
 * Insert each line from a file into an array.
 * 
 * @param {*} file 
 * @param {*} arr
 * @param {*} source
 */
async function fileToArray(file, arr, source) {
  return new Promise((resolve, reject) => {
    const lineReader = readline.createInterface({
      input: fs.createReadStream(file)
    });
    
    lineReader.on('line', function (line) {
      arr.push([source, line])
    });
    
    lineReader.on('close', function () {
      console.log(`${source} events: ${arr.length}`);
      resolve();
    });    
  });  
}

async function arrayToDb(arr) {

  return new Promise((resolve, reject) => {

    const placeholders = arr.map(() => "(?, ?)").join(', ');
    const insertStmt = `INSERT INTO events (source, data) VALUES ${placeholders}`;

    db.serialize(function() {
      db.run("begin transaction");
  
      // for (var i = 0; i < arr.length; i++) {
        db.run(insertStmt, arr.flat());
      // }

      db.run("commit", (res, err) => {
        if (err) reject()
        else {
          resolve();
        }
      });
    });
  });
}

async function logFailedTest(filename, errorMsg, data) {

  const failedTestsFolder = path.join(testreportFolder, 'failedTests');
  if (!fs.existsSync(failedTestsFolder)) fs.mkdirSync(failedTestsFolder);

  fs.writeFile(path.join(failedTestsFolder, filename), errorMsg + ':\n' + data, (err) => {
    if (err)
      console.log(err);
    else {
      console.log("Error log file written successfully\n");
    }
  });
}

describe('Events Splitter', function() {
  this.timeout(defaultTimeOut);

  before(async function() {
    agentEvents = [];
    target1Events = [];
    target2Events = [];

    // fill up the arrays with all rows from the agent / target1 / target2 files
    // await Promise.all([
    //     toArray(agentFile, agentLines, 'Agent'),
    //     toArray(target1File, target1Lines, 'Target1'),
    //     toArray(target2File, target2Lines, 'Target2')
    // ]);
    await fileToArray(agentFile, agentEvents, 'Agent');
    await fileToArray(target1File, target1Events, 'Target1');
    await fileToArray(target2File, target2Events, 'Target2');
  });

  after(async function() {
    // clear out the data and close the db
    // db.run("DELETE FROM events");
    db.close();
  });

  describe('Validate events', async function() {
      
    before(async function() {
      // use extended timeout duration - filling up the database with millions of rows can take some time
      this.timeout(extendedTimeOut);

      // bulk insert records from the events arrays into the db - this is done in chunks of 16383 records due to
      // the limit set by sqlite (SQLITE_MAX_VARIABLE_NUMBER)
      const allEvents = [...target2Events, ...agentEvents, ...target1Events];
      console.log(`inserting ${allEvents.length} records into database...`);
      console.log(`db insert start time: ${(new Date()).toLocaleTimeString()}`);
  
      for (let i = 0; i < allEvents.length; i += 16383) {
        await arrayToDb(allEvents.slice(i, 16383 + i));
      }
      console.log(`db insert end time: ${(new Date()).toLocaleTimeString()}`);

    });
    
    it('target event count should equal agent event count', async() => {

      // verify that the number of events in Target1 and Target2 is equal to the number of events from the Agent host/app
      
      const agentCount = agentEvents.length;
      const targetCount = target1Events.length + target2Events.length;

      const errorMsg = `AGENT EVENTS: ${agentCount},  TARGET EVENTS:  ${targetCount}`;
      if (agentCount != targetCount) {
        const filename = 'target-event-count-should-equal-event-count.log';
        logFailedTest(filename, errorMsg, ' ');
      }
      expect(agentCount).to.equal(targetCount, errorMsg);
    });

    it('agent event should not exist in both targets', async() => {

      // verify that each event from the Agent does not exist both targets

      const rows = await new Promise((resolve, reject) => 
        db.all(`SELECT data FROM events WHERE source = 'Target1' INTERSECT SELECT data FROM events WHERE source = 'Target2'`, (err, rows) => {
          if (err) reject(err)
          else resolve(rows);
        })
      );
      const errorMsg = `${rows.length} EVENTS ARE IN BOTH TARGETS`;
      if (rows.length > 0) {
        // write the erroneous records to a log file
        const filename = 'agent-events-should-not-exist-in-both-targets.log';
        const lines = (rows.map(a => a.data)).join('\r\n');
        logFailedTest(filename, errorMsg, lines);
      }
      expect(rows.length).to.equal(0, errorMsg);
    });

    it('every agent event should exist in a target', async() => {

      // verify that every agent event has been written to a target
      // if an agent line was missed, then the assertion is thrown

      const rows = await new Promise((resolve, reject) => 
        db.all(`SELECT data FROM events WHERE source = 'Agent' EXCEPT SELECT data FROM events WHERE source IN ('Target1', 'Target2')`, (err, rows) => {
          if (err) reject(err)
          else resolve(rows);
        })
      );

      const errorMsg = `${rows.length} AGENT EVENTS ARE NOT IN A TARGET`;
      if (rows.length > 0) {
        // write the erroneous records to a log file
        const filename = 'every-agent-event-should-exist-in-a-target.log';
        const lines = (rows.map(a => a.data)).join('\r\n');
        logFailedTest(filename, errorMsg, lines);
      }
      expect(rows.length).to.equal(0, errorMsg);        
    });

    it('targets should not contain events that are not in the agent', async() => {

      // verify that Target1 and Target2 do not contain any events that are not in the agent file
      // this will help catch any events that are mistakenly truncated

      const rows = await new Promise((resolve, reject) => 
        db.all(`SELECT data FROM events WHERE source IN ('Target1', 'Target2') EXCEPT SELECT data FROM events WHERE source = 'Agent'`, (err, rows) => {
            if (err) reject(err)
            else resolve(rows);
        })
      );
      const errorMsg = `${rows.length} EVENTS FOUND IN THE TARGETS THAT ARE NOT IN THE AGENT`;
      if (rows.length > 0) {
        // write the erroneous records to a log file
        const filename = 'targets-should-not-contain-events-that-are-not-in-the-agent.log';
        const lines = (rows.map(a => a.data)).join('\r\n');
        logFailedTest(filename, errorMsg, lines);
      }
      expect(rows.length).to.equal(0, errorMsg);
    });

  });
});