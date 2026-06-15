"""Supabase client singleton.

WHY: The backend talks to Supabase with the *service role* key so it can
bypass row-level security — this is trusted server code, not the browser.
The client is created once and reused to avoid per-request connection setup.
"""

from supabase import Client, create_client

from config import SUPABASE_SERVICE_KEY, SUPABASE_URL

_client: Client | None = None


def get_supabase() -> Client:
    """Return the shared Supabase client, creating it on first use."""
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in the environment."
            )
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client
