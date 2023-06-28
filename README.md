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
After the events have been split (by starting the Docker containers as outlined in the [Running the splitter](##running-the-splitter) section), a suite of automated tests can be run to verify the correctness of the split.

Pre-reqs for running the tests on your local machine: 
1. Install [Docker](https://www.docker.com/products/docker-desktop/)
2. Run `npm install` to install all the test dependencies

To run the tests (from a terminal):
1. Run `npm run test` - this will automatically start up the docker containers, run the tests, and then teardown the docker containers when the tests complete

After a test run, the following are written to the `testreport` folder:
1. `testreport.html` - mochawesome report showing the passed/failed test cases
2. `targetX_events.log` - the events.log files (raw data from the split) from the Target containers 
3. `failedTests` - folder containing a log file for each failed test with detailed information about the failure
4. `containers_console.log` - console logs from each of the containers
5. `events.db` - the sqlite3 database used by the tests, contains the Agent and Target events

## CI
The tests in this repo have been set up to automatically run whenever any code changes are pushed up to GitHub. This is achieved by a GitHub Actions workflow ([.github/workflows/test-pr.yml](https://github.com/clhobbs/events-splitter/blob/main/.github/workflows/test-pr.yml)) file. All test runs triggered by this workflow can be seen under the [Actions](https://github.com/clhobbs/events-splitter/actions) tab. To trigger the GitHub Actions workflow do the following:
1. `git pull` to get the latest code
2. `git checkout -b new-branch-name` to create a local branch
3. Make some code changes and then `git add` the changed files and `git commit -m "change description"` to create a commit containing the changed files
4. `git push --set-upstream origin new-branch-name` to push the commit to GitHub
5. Create a PR and select the 'Checks' tab in the PR

The steps outlined in the GitHub Actions .yml file start running as soon as the PR is created; their status can be seen from the 'Checks' tab. If there are failures, the `testreport` folder can be downloaded from the workflow run under the [Actions](https://github.com/clhobbs/events-splitter/actions) tab.

## Approach
Detailed information about the choices made for running and testing the Events Splitter:

- [Docker](https://docs.docker.com/get-docker/) provides a very fast and easy way to spin up the 4 machines (Agent, Splitter, Target-1, Target-2) and perform the split, especially since a docker-compose.yml file can be used to start/stop all 4 containers with a single command (`docker compose up` or `docker compose down`). One challenge I faced was how to get the `events.log` file from each of the Target containers. At first, I used volumes to share the Target container `events.log` files with the host filesystem, but then I read that people were having trouble with Docker volumes in GitHub Actions, so I decided to use `docker cp` instead. I think there may be a workaround for getting volumes to work in GitHub Actions (an "options" setting?), but the `docker cp` is very reliable so I decided to stick with that. By setting up a `pretest` script in package.json, I was able to `docker cp` the Target container `events.log` files to the host file system at the start of every test run. The obvious requirement is that the Target containers have to be up when `npm run test` is run. The challenge I faced here was: how do I know that the Targets have finishing writing their `events.log` files prior to running the tests? This is especially an issue when performing the `npm run docker-up` and `npm run test` steps from GitHub Actions. I decided to just add a 5 second delay between these 2 steps in GitHub Actions in order to give the Targets that extra time to write to the files. Upon performing several test runs, the 5 seconds appears to be enough time, but I don't think adding a static delay like this is optimal. This is one part of this solution where I believe there is room for improvement. 

- [SQLite](https://www.sqlitetutorial.net) database is used by the tests because it is a good way to perform set operations on the Agent/Target event data. The objective of the Events Splitter automated tests is to verify that the Target-1 events + Target-2 events = the Agent events. I thought that SQL set operations (union, intersect, except, etc) would allow me to write useful queries to validate the Target event data. Also, since the volume of data was quite large (1M Agent events), I thought a database of the events data should allow for more performant tests. One additional benefit of using the sqlite db is that it can be a useful tool for performing further analysis on the data after the test run completes since the data persists in the db. SQLite queries can be run from the command line against the `events.db` and can help troubleshoot issues.

- [Mocha](https://mochajs.org) was chosen for the tests since I have used it on other projects and I knew it would allow me to use the [mochawesome](https://www.npmjs.com/package/mochawesome) report which provides a nice summary of the passed/failed tests in an HTML report. I also knew I could use the [Chai assertion library](https://www.chaijs.com) with Mocha which would allow me to use the `expect` syntax, which I prefer over `assert`.

- [GitHub Actions](https://docs.github.com/en/actions) was chosen for CI/CD automation since I have used it on other projects and it proved to be a very useful tool for running the automated tests as soon as a PR is opened. GitHub Actions also work with Docker containers and are able to store the test artifacts for up to 90 days. However, I chose to only store the `testreport` folder for 1 day.
