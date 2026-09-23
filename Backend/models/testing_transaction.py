from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field 

Currency = Literal[
    "US Dollar", "Euro", "Bitcoin", "Yuan", "Yen", "UK Pound",
    "Brazil Real", "Australian Dollar", "Rupee", "Ruble",
    "Canadian Dollar", "Mexican Peso", "Swiss Franc", "Shekel", "Saudi Riyal",
]

PaymentFormat = Literal[
    "ACH", "Bitcoin", "Cash", "Cheque", "Credit Card", "Reinvestment", "Wire",
]

class Transaction(BaseModel):
    from_bank: str = Field(min_length=1)
    from_account: str = Field(min_length=1)
    to_bank: str = Field(min_length=1)
    to_account: str = Field(min_length=1)
    timestamp: datetime
    amount_paid: float = Field(gt=0)
    payment_currency: Currency
    amount_received: float = Field(gt=0)
    receiving_currency: Currency
    payment_format: str = PaymentFormat

    def to_infer_row(self) -> dict:
        row = {
            "From Bank": self.from_bank,
            "Account": self.from_account,
            "To Bank": self.to_bank,
            "Account.1": self.to_account,
            "Timestamp": self.timestamp.strftime("%Y/%m/%d %H:%M"),
            "Amount Paid": self.amount_paid,
            "Payment Currency": self.payment_currency,
            "Amount Received": self.amount_received,
            "Receiving Currency": self.receiving_currency,
            "Payment Format": self.payment_format,
        }
        return row

class PredictRequest(BaseModel):
    transactions: list[Transaction] = Field(min_length=1)