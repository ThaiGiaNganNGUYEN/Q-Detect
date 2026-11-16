"""Removed from models/transaction.py (Transaction.edge_attrs) -- its only
caller was unused/services/build_laundering_graph.py. Kept for reference."""


def edge_attrs(self) -> dict:
    """
    Flat dict of primitive values only -- for use as a NetworkX/GEXF
    edge attribute set. Graph file formats can't store nested objects,
    so sender/receiver identity is carried by which two nodes this
    edge connects, not by attributes on the edge itself.
    """
    return {
        "amount_paid": self.amountPaid,
        "amount_received": self.amountReceived,
        "currency_paid": self.currencyPaid,
        "currency_received": self.currencyReceived,
        "payment_format": self.paymentFormat,
        "timestamp": str(self.timestamp),
        "hours_from_start": self.hoursFromStart,
        "is_cross_bank": int(self.isCrossBank),
        "is_cross_currency": int(self.isCrossCurrency),
        "is_self_transfer": int(self.isSelfTransfer),
        "is_laundering": int(self.isLaundering),
        "fraud_risk_score": self.fraudRiskScore,
    }
