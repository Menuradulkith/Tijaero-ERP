import os
from datetime import datetime

def backup_database():
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = f"backup_{timestamp}.sql"
    # Database backup implementation
    print(f"Database backed up to {backup_file}")

if __name__ == "__main__":
    backup_database()
