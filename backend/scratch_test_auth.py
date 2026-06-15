import os
from dotenv import load_dotenv
load_dotenv()

from db.client import get_supabase

def test_auth():
    print("Connecting to Supabase...")
    sb = get_supabase()
    
    # Check if we can access the auth admin API to list users
    try:
        print("Fetching user list from Supabase Auth...")
        # In supabase-py, the auth admin functions are under client.auth.admin
        users_resp = sb.auth.admin.list_users()
        users = users_resp
        
        found = False
        print(f"Total users found: {len(users)}")
        for u in users:
            print(f"- ID: {u.id}, Email: {u.email}, Confirmed: {u.email_confirmed_at}")
            if u.email == "sarafrishi77@gmail.com":
                found = True
        
        if not found:
            print("User sarafrishi77@gmail.com NOT found in Supabase Auth.")
        else:
            print("User sarafrishi77@gmail.com found in Supabase Auth!")
            
    except Exception as e:
        print(f"Error accessing auth admin: {e}")

if __name__ == "__main__":
    test_auth()
