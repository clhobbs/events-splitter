const { expect } = require('chai');

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const spawn = require('child_process').spawn;

const sqlite3 = require('sqlite3').verbose();
let db = new sqlite3.Database('./test/events.db');

let extendedTimeout = 90000;  // for long-running hooks or tests

// for reporting test case failures
let errorMsg = '';
let errorData = '';
const testreportFolder = path.join(__dirname, '../testreport');
const failedTestsFolder = path.join(testreportFolder, 'failedTests');
 
/**
 * Insert each line from an events file into an events array.
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

/**
 * Insert an array of values into the events table in the db.
 * 
 * @param {*} arr 
 */
async function arrayToDb(arr) {

  return new Promise((resolve, reject) => {

    const placeholders = arr.map(() => "(?, ?)").join(', ');
    const insertStmt = `INSERT INTO events (source, data) VALUES ${placeholders}`;

    db.serialize(function() {
      db.run("begin transaction");
  
      db.run(insertStmt, arr.flat());

      db.run("commit", (res, err) => {
        if (err) reject()
        else {
          resolve();
        }
      });
    });
  });
}

/**
 * Run a command as a child process (e.g 'docker compose up'). Spawn is used in this method so that
 * stdout is streamed instead of buffered.
 * 
 * @param {*} cmd the command to run, e.g 'docker'
 * @param {*} args an array of args used by the cmd, e.g ['compose', 'up']
 */
async function runCommand(cmd, args) {
  await new Promise((resolve, reject) => {
    let child = spawn(cmd, args);
    // display stdout on screen
    child.stdout.on('data', function (data) {   process.stdout.write(data.toString());  });

    // display stderr on screen
    child.stderr.on('data', function (data) {   process.stdout.write(data.toString());  });

    child.on('close', function (code) { 
      console.log('finished with code ' + code);
      resolve();
    });
  });  
}

describe('Events Splitter', function() {

  let agentEvents = [];
  let target1Events = [];
  let target2Events = [];

  before(async function() {
    this.timeout(extendedTimeout);

    // start docker
    console.log('starting docker containers... this can take a minute');
    await runCommand('npm', ['run', 'docker-restart']);

    // wait 5 seconds for the Splitter to complete and the Target events.log files to be written
    await new Promise((res) => setTimeout(res, 5000));

    // copy the Target events files to the testreport folder
    console.log('copying Target event files');
    if (!fs.existsSync(testreportFolder)) await fs.promises.mkdir(testreportFolder);
    await runCommand('docker', ['cp', 'Target-1:events.log', 'testreport/target1_events.log']);
    await runCommand('docker', ['cp', 'Target-2:events.log', 'testreport/target2_events.log']);

    // fill up the arrays with all rows from the agent / target1 / target2 files
    const agentFile = path.join(__dirname, '../agent/inputs/large_1M_events.log');
    const target1File = path.join(__dirname, '../testreport/target1_events.log');
    const target2File = path.join(__dirname, '../testreport/target2_events.log');
  
    await Promise.all([
        fileToArray(agentFile, agentEvents, 'Agent'),
        fileToArray(target1File, target1Events, 'Target1'),
        fileToArray(target2File, target2Events, 'Target2')
    ]);
  });

  after(async function() {
    this.timeout(extendedTimeout);

    // copy the db to the testreports folder, clear out the data and close the db
    await fs.promises.copyFile('./test/events.db', './testreport/events.db');
    db.run("DELETE FROM events");
    db.close();    

    // copy console logs from the containers to the testreport folder
    await runCommand('npm', ['run', 'copy-logs']);

    // shutdown docker containers
    console.log('stopping docker...');
    await runCommand('npm', ['run', 'docker-down']);
  });

  describe('Validate events', async function() {
      
    before(async function() {
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
    
    afterEach(async function(){
      if (this.currentTest.state == 'failed') {
        // write the failed test to the testreport/failedTests folder
        if (!fs.existsSync(failedTestsFolder)) await fs.promises.mkdir(failedTestsFolder);
        
        // replace special characters and spaces for the filename
        let filename = this.currentTest.title.replace(/[\W_]+/g, "-").trim() + '.log';

        fs.writeFile(path.join(failedTestsFolder, filename), errorMsg + ':\n' + errorData, (err) => {
          if (err) console.log(err);
          else console.log("failedTest log file written successfully\n");
        });
      }
    });

    it('target event count should equal agent event count', async() => {

      // verify that the number of events in Target1 and Target2 is equal to the number of events from the Agent host/app
      
      const agentCount = agentEvents.length;
      const targetCount = target1Events.length + target2Events.length;

      errorMsg = `AGENT EVENTS: ${agentCount},  TARGET EVENTS:  ${targetCount}`;
      errorData = ' ';
      expect(agentCount).to.equal(targetCount, errorMsg);
    });

    it('should not have duplicate agent or target events', async() => {

      // all events in the Agent host/app shouold be unique, and therefore events in the Targets after being split should also be unique

      const rows = await new Promise((resolve, reject) => 
        db.all(`SELECT source, data, count(*) count FROM events GROUP BY source, data HAVING count(*) > 1`, (err, rows) => {
          if (err) reject(err)
          else resolve(rows);
        })
      );
      errorMsg = `${rows.length} DUPLICATE EVENTS EXIST`;
      if (rows.length > 0) {
        errorData = (rows.map(a => `${a.source}: ${a.count} events: ${a.data}`)).join('\r\n');
      }
      expect(rows.length).to.equal(0, errorMsg);
    });

    it('agent event should not exist in both targets', async() => {

      // verify that an event from the Agent does not exist both targets

      const rows = await new Promise((resolve, reject) => 
        db.all(`SELECT data FROM events WHERE source = 'Target1' INTERSECT SELECT data FROM events WHERE source = 'Target2'`, (err, rows) => {
          if (err) reject(err)
          else resolve(rows);
        })
      );
      errorMsg = `${rows.length} EVENTS ARE IN BOTH TARGETS`;
      if (rows.length > 0) {
        errorData = (rows.map(a => a.data)).join('\r\n');
      }
      expect(rows.length).to.equal(0, errorMsg);
    });

    it('every agent event should exist in a target', async() => {

      // verify that every Agent event has been written to a target

      const rows = await new Promise((resolve, reject) => 
        db.all(`SELECT data FROM events WHERE source = 'Agent' EXCEPT SELECT data FROM events WHERE source IN ('Target1', 'Target2')`, (err, rows) => {
          if (err) reject(err)
          else resolve(rows);
        })
      );

      errorMsg = `${rows.length} AGENT EVENTS ARE NOT IN A TARGET`;
      if (rows.length > 0) {
        errorData = (rows.map(a => a.data)).join('\r\n');
      }
      expect(rows.length).to.equal(0, errorMsg);        
    });

    it('targets should not contain events that are not in the agent', async() => {

      // verify that Target1 and Target2 do not contain any events that are not in the Agent file

      const rows = await new Promise((resolve, reject) => 
        db.all(`SELECT 'Target1' source, data FROM events WHERE source = 'Target1' EXCEPT SELECT 'Target1' source, data FROM events WHERE source = 'Agent'
                UNION
                SELECT 'Target2' source, data FROM events WHERE source = 'Target2' EXCEPT SELECT 'Target2' source, data FROM events WHERE source = 'Agent'`, (err, rows) => {
            if (err) reject(err)
            else resolve(rows);
        })
      );
      errorMsg = `${rows.length} EVENTS FOUND IN THE TARGETS THAT ARE NOT IN THE AGENT`;
      if (rows.length > 0) {
        errorData = (rows.map(a => `${a.source}: ${a.data}`)).join('\r\n');
      }
      expect(rows.length).to.equal(0, errorMsg);
    });

  });
});