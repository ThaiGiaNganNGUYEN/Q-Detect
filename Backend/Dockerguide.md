# Docker User Guide — Q-Detect Backend
Purpose
This guide explains how to use Docker for the Q-Detect backend.

# IMPORTANT #########
*Docker must be downloaded on local machine before contrainers could work*

## The app uses two main Docker services:

server = Python / FastAPI backend
db     = PostgreSQL database
Docker Compose starts both services, connects them on the same internal network, and provides the environment variables the backend needs.

## Important files
*Dockerfile*
Defines how the backend image is built.

It usually handles:

choosing the Python version
installing uv
installing dependencies from pyproject.toml and uv.lock
copying the backend source code
exposing port 8000
starting the FastAPI server
compose.yaml
Defines how the app runs as multiple services.

### In this project, it defines:

server
db
ports
volumes
environment variables
service dependencies
.env
Used by Docker Compose.

#### Example:

POSTGRES_USER=qdetect_dev
POSTGRES_PASSWORD=devQdetect
POSTGRES_DB=qdetect_test
DATABASE_URL=postgresql+psycopg://qdetect_dev:devQdetect@db:5432/qdetect_test
Inside Docker, the database hostname is:

db
because db is the Docker Compose service name.

.env.local
Used for local development without Docker.

#### Example:

DATABASE_URL=postgresql+psycopg://qdetect_dev:devQdetect@127.0.0.1:5432/qdetect_test

### Test running files
*Use this when running local commands like:*
uv run --env-file .env.local database_builder.py

.dockerignore
Tells Docker what not to copy into the image.

Recommended:

.venv
.env
.env.local
__pycache__
*.pyc
.git
.pytest_cache
This keeps the Docker image clean and avoids copying secrets or local virtual environments.

## Main commands
Start the full app
Run from the Backend folder:

docker compose up --build
Meaning:

Build the backend image if needed.
Start the backend server.
Start the PostgreSQL database.
Show logs in the terminal.
Use this when you want the full backend app running.

Start services in the background
*docker compose up -d*
Meaning:

Start containers in detached/background mode.
Stop all services
docker compose down
Meaning:

Stop and remove the running containers.
Keep the database volume.
Stop services and delete database data
docker compose down -v
Meaning:

Stop containers.
Remove containers.
Delete Docker volumes.
Delete PostgreSQL data.
Use carefully.

Check container status
docker compose ps
Expected result:

*server   running*
*db       healthy*
Meaning:

server running = backend is up
db healthy     = PostgreSQL is ready
View logs
All logs:

docker compose logs
Server logs:

docker compose logs server
Database logs:

docker compose logs db
Follow server logs live:

docker compose logs -f server
Running the backend app

*Note : docker logs automatically in Docker Desktop GUI*

If the Dockerfile has:

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
then the backend starts automatically when running:

docker compose up
Open:

http://localhost:8000
FastAPI docs:

http://localhost:8000/docs
Running a specific Python file in Docker
To run a single file instead of the main app:

docker compose run --rm server python database_builder.py
Meaning:

docker compose run = start a temporary container
--rm               = remove it after it finishes
server             = use the backend service image
python file.py     = run this file instead of the default command
This is the Docker equivalent of:

uv run database_builder.py
Running database_builder.py with Docker and uv
Recommended command:

docker compose up -d db
docker compose run --rm server uv run database_builder.py
Meaning:

Start the database first.
Run database_builder.py inside a temporary server container.
Use uv to run the script in the project environment.
Remove the temporary container afterward.
If there is a uv cache permission issue, use:

docker compose run --rm -e UV_CACHE_DIR=/tmp/uv-cache server uv run database_builder.py
Running with the virtual environment Python directly
If uv run has runtime issues, use the container’s project virtual environment directly:

docker compose run --rm server /app/.venv/bin/python database_builder.py
This uses the Python environment where Docker installed the project dependencies.

Running inside an existing container
If the server container is already running:

docker compose exec server python database_builder.py
Difference:

Command	Meaning
docker compose run --rm server python file.py	Starts a temporary container
docker compose exec server python file.py	Runs inside an already-running container
Open a shell inside the backend container
docker compose run --rm server sh
Inside the container:

pwd
ls
python database_builder.py
Exit:

exit
Database commands
Start only the database
docker compose up -d db
Use this when you want PostgreSQL running without starting the backend app.

Connect to PostgreSQL
docker compose exec db psql -U qdetect_dev -d qdetect_test
Inside psql, list tables:

\dt
Exit:

\q
Check tables with one command
docker compose exec db psql -U qdetect_dev -d qdetect_test -c "\dt"
Database hostname rule
Inside Docker
Use:

db
Example:

DATABASE_URL=postgresql+psycopg://qdetect_dev:devQdetect@db:5432/qdetect_test
Outside Docker
Use:

127.0.0.1
Example:

DATABASE_URL=postgresql+psycopg://qdetect_dev:devQdetect@127.0.0.1:5432/qdetect_test
Reason:

Inside Docker, containers talk to each other using service names.
Outside Docker, your laptop reaches PostgreSQL through localhost/127.0.0.1.
Local development without Docker
Run a file locally:

uv run --env-file .env.local database_builder.py
Run the FastAPI backend locally:

uv run --env-file .env.local uvicorn app:app --reload
Meaning:

uv run                 = run using uv's project environment
--env-file .env.local  = load local environment variables
uvicorn app:app        = start the FastAPI app
--reload               = restart automatically after code changes
Common issues
pg_config executable not found
Cause:

psycopg2 is trying to build from source.
Recommended fix:

uv remove psycopg2
uv add "psycopg[binary]"
uv lock
docker compose up --build
Use this database URL format:

DATABASE_URL=postgresql+psycopg://qdetect_dev:devQdetect@db:5432/qdetect_test
No module named 'sqlmodel'
Cause:

The command is using system Python instead of the project virtual environment.
Fix:

docker compose run --rm server /app/.venv/bin/python database_builder.py
Or make sure the Dockerfile includes:

ENV PATH="/app/.venv/bin:$PATH"
Then rebuild:

docker compose build --no-cache
uv cache /nonexistent/.cache/uv permission denied
Cause:

uv is trying to use an unwritable cache directory at runtime.
Fix:

docker compose run --rm -e UV_CACHE_DIR=/tmp/uv-cache server uv run database_builder.py
Better long-term Dockerfile setup:

ENV UV_CACHE_DIR=/tmp/uv-cache
ENV PATH="/app/.venv/bin:$PATH"
Then run the app directly:

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
Git warnings
Backend/.gitignore: Permission denied
This should be fixed because Git may not apply ignore rules properly.

Important files that should not be committed:

Backend/.env
Backend/.env.local
Backend/.venv/
Backend/__pycache__/
Backend/.pytest_cache/
Recommended .gitignore entries:

.venv
.env
.env.local
__pycache__
*.pyc
.pytest_cache
LF will be replaced by CRLF
This is common on Windows.

It is usually not dangerous, but it is cleaner to standardize line endings.

Recommended root .gitattributes:

* text=auto

*.py text eol=lf
*.toml text eol=lf
*.lock text eol=lf
*.yaml text eol=lf
*.yml text eol=lf
Dockerfile text eol=lf
*.md text eol=lf
*.sh text eol=lf
Then run:

git add --renormalize .
git status
Recommended workflows
Full Docker app
docker compose up --build
Run database setup in Docker
docker compose up -d db
docker compose run --rm server uv run database_builder.py
Run database setup locally
uv run --env-file .env.local database_builder.py
Check database tables
docker compose exec db psql -U qdetect_dev -d qdetect_test -c "\dt"
Reset everything
docker compose down -v
docker compose up --build
Warning:

docker compose down -v deletes PostgreSQL data.
Mental model
Dockerfile
  = how to build the backend image

compose.yaml
  = how to run backend + database together

.env
  = Docker environment variables

.env.local
  = local development environment variables

.venv
  = local Python dependencies, not copied into Docker

uv.lock
  = exact dependency versions

db-data volume
  = persisted PostgreSQL data
Most useful command summary

# TLDR
# Start full app
docker compose up --build

# Start in background
docker compose up -d

# Stop app
docker compose down

# Stop app and delete database data
docker compose down -v

# Check status
docker compose ps

# View server logs
docker compose logs -f server

# Start only database
docker compose up -d db

# Run database builder inside Docker using uv
docker compose run --rm server uv run database_builder.py

# Run database builder with explicit uv cache
docker compose run --rm -e UV_CACHE_DIR=/tmp/uv-cache server uv run database_builder.py

# Run database builder with venv Python
docker compose run --rm server /app/.venv/bin/python database_builder.py

# Check database tables
docker compose exec db psql -U qdetect_dev -d qdetect_test -c "\dt"

# Open shell inside backend container
docker compose run --rm server sh

# Local run without Docker
uv run --env-file .env.local database_builder.py

# Local FastAPI run without Docker
uv run --env-file .env.local uvicorn app:app --reload
Final rule
Use this for the full Docker app:

docker compose up --build
Use this for one specific file inside Docker:

docker compose run --rm server uv run database_builder.py
Use this for local development without Docker:

uv run --env-file .env.local database_builder.py