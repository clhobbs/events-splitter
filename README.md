# Events Splitter
The Events Splitter receives events from 1 host (the Agent) and randomly sends them to different hosts (the Targets). A collection of automated tests are then used test the correctness of the events received by the Targets. After cloning this repo, the Events Splitter can be run and tested, as follows:

## Running the splitter
The Events Splitter uses Docker containers as follows:
- 1 'Agent' container: this is the host app that sends a series of events (from a file) to the Splitter
- 1 'Splitter' container: randomly sends each event that it receives from the Agent to Target1, Target2
- 2 'Target' containers: receives the events and writes them to an events.log file in their container

To start/stop the Docker containers, the following scripts can be run from the base `events-splitter` folder:
- `npm run docker-up`: starts all containers (as outlined in docker-compose.yml)
- `npm run docker-down`: stops all containers
- `npm run docker-restart`: performs a complete restart of the docker containers by running `docker-down` first, followed by `docker-up`

## Testing the split
After the events have been split (by starting the Docker containers as outlined in the 'Running the splitter' section), a suite of automated tests can be run to verify the correctness of the split.

To run the tests (locally from a terminal):
1. Make sure the split has been performed and the Docker containers are UP.  NOTE: Docker Desktop is a good tool to use to see the state of the containers
2. Run `npm install` to install all the test dependencies
3. `npm run test`

To run the tests (automatically from Github):
1. TO DO

After a test run, the following are written to the `testreports` folder:
1. `testreport.html` - mochawesome report showing the passed/failed test cases
2. `targetX_events.log` - the events.log files (raw data from the split) from the Target containers 
3. `failedTests` - folder containing a log file for each failed test with detailed information about the failure
4. `[container_name]_console.log` - console logs from each of the containers
5. `events.db` - the sqlite3 database used by the tests, contains the Agent and Target events