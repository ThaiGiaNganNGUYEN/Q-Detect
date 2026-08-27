# This is a the class that will feed our model with data.
# Imoports the csv file, stores in postgres
# Pulls periodically (with backend wait)

import csv
import psycopg

namespace = "Q-Detect/Backend/DataPipeline/datamaker.py"
class DataMaker:
    # Counter to keep track of the number of rows processed
    count : int = 0
    filesize : int = 0

    def __init__(self, csv_file_path, db_connection_string):
        self.csv_file_path = csv_file_path
        self.db_connection_string = db_connection_string

    def import_csv_to_postgres(self):
        with psycopg.connect(self.db_connection_string) as conn:
            with conn.cursor() as cur:
                with open(self.csv_file_path, 'r') as f:
                    reader = csv.reader(f)
                    next(reader)  # Skip the header row
                    for row in reader:
                        cur.execute(
                            "INSERT INTO transactions (transaction_id, sender_acc, receiver_acc, amount, transaction_type) VALUES (%s, %s, %s, %s, %s)",
                            row
                        )
            conn.commit()

    def validate_data(self):
        with psycopg.connect(self.db_connection_string) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM transactions")
                datacount = cur.fetchone()[0]
                if (datacount != self.filesize -1):  # Subtract 1 for the header row
                    print(f"Data validation failed: Expected {self.filesize - 1} rows, but found {datacount} rows in the transactions table.")
                    return False
                else:
                    print(f"Data validation successful: Found {datacount} rows in the transactions table.")
                    return True

    def process_csv(self):
        """Validates the csv import saving to database"""
        try:
            with open(self.csv_file_path, 'r') as f:
                self.filesize = sum(1 for row in f)
            self.import_csv_to_postgres()
            if not self.validate_data():
                ## Do something ( re-prompt user to re-upload csv file )
                print("Data validation failed.")
        except Exception as e:
            print(f"Error processing CSV file: {e}")

    ## But now, the data is ordered by insert time, we want it to be ordered by transaction date, so we will sort it before sending it to the model
    def sort_data(self):
        """Sorts the data based on transaction date"""
        with psycopg.connect(self.db_connection_string) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM transactions ORDER BY transaction_date")
                sorted_data = cur.fetchall()
        return sorted_data


    def send_data(self):
        """Sends data to the model for processing"""
        # Placeholder for sending data to the model
        print("Sending data to the model...")
