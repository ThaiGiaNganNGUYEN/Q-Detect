from genericpath import exists
import Classes
from sqlmodel import SQLModel, create_engine

def createDatabase():
# Connect to your existing PostgreSQL database
    try:
        conn = psycopg2.connect(
            dbname="qdetect_test_db",
            user="superadmin",
            password="superman",
            host="localhost",
            port="1888"
        )



        cursor = conn.cursor()
        # Print PostgreSQL details
        print("PostgreSQL server information")
        print(conn.get_dsn_parameters(), "\n")

        # Executing a SQL query
        cursor.execute("SELECT version();")

        # Fetch result
        record = cursor.fetchone()
        print("You are connected to - ", record, "\n")


        cursor.close()
        conn.close()
    except (Exception, psycopg2.Error) as error:
        print("Error while connecting to PostgreSQL", error)
    finally:
        if (conn):
            cursor.close()
            conn.close()
            print("PostgreSQL connection is closed")

def createEngine():
    """Creates Database using SQLAlchemy engine"""

    # Guardrail to check if database already exists before creating. If not, create it.
    # Single source of truth for database creation.
    engine = create_engine("postgresql+psycopg://qdetect_dev:devQdetect@127.0.0.1:5432/qdetect_test", echo=True) # Echo = true for debugging
    SQLModel.metadata.create_all(engine)

# createDatabase()
createEngine()