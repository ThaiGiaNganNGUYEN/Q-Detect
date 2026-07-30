class Transaction:
        """A class for transactions, used in cache, backend filtering, quantum and frontend"""
        
        def __init__(self, transactionId : str, senderAcc : str, receiverAcc : str, amount : int, transactionType : str ):
                self.transactionId = transactionId
                self.senderAcc = senderAcc
                self.receiverAcc = receiverAcc
                self.amount = amount
                self.transactionType = transactionType
                self.riskScore = 0

        def setRiskScore(self, riskScore):
                self.riskScore = riskScore
                