"""Simple in-memory session store for single-user research tool."""
store = {}

# Fixed session key — no cookie dependency
SINGLE_USER_SID = "default"


def get_session():
    """Get or create the single-user session."""
    if SINGLE_USER_SID not in store:
        store[SINGLE_USER_SID] = {}
    return store[SINGLE_USER_SID]
