"""Run the ML model service: `uv run main.py` (http://127.0.0.1:8001)."""

import os

import uvicorn

from service import app


def main():
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8001")))


if __name__ == "__main__":
    main()
