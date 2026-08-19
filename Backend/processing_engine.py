import csv
import logging
from datetime import datetime, time

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
DATA_FILE_PATH = r"D:\Downloads\LI-Small_Trans.csv"  # Local IBM AML dataset (LI-Small)
DEV_SAMPLE_SIZE = 50_000          # Initial development stage: first 50k rows only
LARGE_AMOUNT_THRESHOLD = 3333.10# Heuristic 2: big amount
UNUSUAL_TIME_START = time(23, 0)  # Heuristic 3: 11pm onwards...
UNUSUAL_TIME_END = time(6, 0)     # ...until 6am

# IBM AML dataset timestamp format, e.g. "2022/09/01 00:20"
# Known timestamp formats, tried in order:
#   "1/9/2022  12:08:00 AM"  (Excel re-save: day-first date, 12-hour clock)
#   "2022/09/01 00:20"       (original IBM AML export)
TIMESTAMP_FORMATS = (
    "%d/%m/%Y %I:%M:%S %p",
    "%Y/%m/%d %H:%M",
)


class TransactionProcessor:
    """Processes IBM AML transactions and applies heuristics to detect
    potentially high-risk (fraudulent) activity.

    Pipeline:
        1. Load the first `sample_size` transactions from the local CSV
           into a temporary buffer.
        2. Partition transactions into high-risk / low-risk via heuristic checks.
    """

    def __init__(self, sample_size: int = DEV_SAMPLE_SIZE):
        self.sample_size = sample_size
        self.transactions: list[dict] = []       # Temporary buffer (first 50k rows)
        self.high_risk: list[dict] = []          # Flagged by >=1 heuristic
        self.low_risk: list[dict] = []           # Passed all heuristic checks

    # ── Data acquisition ──────────────────────────────────────────────────────

    def process_transactions(self, file_path: str) -> list[dict]:
        """Streams the CSV and caches the first `sample_size` transactions
        into a temporary in-memory buffer."""
        self.transactions = []
        with open(file_path, mode="r", newline="", encoding="utf-8") as csvfile:
            reader = csv.DictReader(csvfile)
            for i, row in enumerate(reader):
                if i >= self.sample_size:
                    break
                self.transactions.append({
                    (k or "").strip(): v.strip() if isinstance(v, str) else v
                    for k, v in row.items()
                })


        logger.info("Loaded %d transactions", len(self.transactions))
        return self.transactions

    # ── Heuristics ────────────────────────────────────────────────────────────

    @staticmethod
    def _is_foreign_transfer(txn: dict) -> bool:
        """Heuristic 1: any cross-currency (foreign) transfer."""
        if not txn.get("Payment Currency") or not txn.get("Receiving Currency"):
            print(f"Missing currency information in transaction: {txn}")

        return txn.get("Payment Currency") != txn.get("Receiving Currency")

    @staticmethod
    def _is_large_amount(txn: dict) -> bool:
        """Heuristic 2: amount exceeds the large-amount threshold."""
        try:
            isLarge:bool = False
            if float(txn.get("Amount Paid", 0)) >= LARGE_AMOUNT_THRESHOLD:
                #logger.info("Large amount detected: %s", txn)
                #print(f"Large amount detected: {txn}")
                isLarge = True
            return isLarge
        except (TypeError, ValueError):
            logger.warning("Unparseable amount, flagging for review: %s", txn)
            return True  # Fail safe: treat malformed amounts as suspicious

    @staticmethod
    def _parse_timestamp(raw_ts: str) -> datetime | None:
        """Tries each known timestamp format. Collapses repeated whitespace
        first — Excel exports put a double space before the time."""
        normalized = " ".join(str(raw_ts).split())
        for fmt in TIMESTAMP_FORMATS:
            try:
                return datetime.strptime(normalized, fmt)
            except ValueError:
                continue
        return None

    @staticmethod
    def _is_unusual_time(txn: dict) -> bool:
        """Heuristic 3: transaction occurs between 11pm and 6am."""
        raw_ts = txn.get("Timestamp", "")
        parsed = TransactionProcessor._parse_timestamp(raw_ts)
        if parsed is None:
            logger.warning("Unparseable timestamp %r, flagging for review", raw_ts)
            return True  # Fail safe: treat malformed timestamps as suspicious
        txn_time = parsed.time()
        return txn_time >= UNUSUAL_TIME_START or txn_time < UNUSUAL_TIME_END

    def heuristic_check(self, txn: dict) -> bool:
        """Returns True if the transaction trips ANY heuristic (high risk)."""
        return (
            self._is_foreign_transfer(txn)
            or self._is_large_amount(txn)
            # or self._is_unusual_time(txn) # for now, we are not using this heuristic as the sample dataset all falls in this range
        )

    # ── Partitioning ──────────────────────────────────────────────────────────

    def filter_transactions(self) -> tuple[list[dict], list[dict]]:
        """Partitions the buffered transactions into high-risk and low-risk
        arrays. Low-risk (unchecked) transactions are the SLM candidates."""
        self.high_risk, self.low_risk = [], []
        for txn in self.transactions:
            (self.high_risk if self.heuristic_check(txn) else self.low_risk).append(txn)

        logger.info(
            "Partitioned %d transactions → %d high-risk, %d low-risk",
            len(self.transactions), len(self.high_risk), len(self.low_risk),
        )
        return self.high_risk, self.low_risk

logging.basicConfig(level=logging.INFO)

processor = TransactionProcessor()
processor.process_transactions(DATA_FILE_PATH)
high_risk, low_risk = processor.filter_transactions()

print(f"High-risk transactions: {len(high_risk)}")
print(f"Low-risk transactions:  {len(low_risk)}")