/**
 * Normalizes the real backend response (Backend/models/cluster.py,
 * transaction.py -- camelCase, Account{accountId,bank,accountNumber})
 * into the same raw shape sampleClustersApi.js uses (cluster_id,
 * amount, sender.id, ...), so adaptCluster/adaptClustersResponse in
 * sampleMuleNetworks.js can build the D3 nodes/links from either source
 * without any change to that file.
 */

// Backend Account has no name field (the dataset has none) -- omit
// last_name rather than fabricate one; adaptCluster's partyLabel()
// already falls back to account_number when last_name is missing.
/** @param {import("../api/contracts").Account | null | undefined} account */
function toRawParty(account) {
	if (!account) {
		return null;
	}
	return {
		id: account.accountId,
		bank: account.bank,
		account_number: account.accountNumber,
	};
}

// Renames the *Paid fields to amount/currency -- adaptCluster only
// ever reads the paid side (what left the sender's account). Every other
// TransactionRead field is carried through as-is so the transaction table
// can display the full backend record, not just a subset.
/** @param {import("../api/contracts").TransactionRead} tx */
function toRawTransaction(tx) {
	return {
		id: tx.transactionId,
		amount: tx.amountPaid,
		currency: tx.currencyPaid,
		timestamp: tx.timestamp,
		payment_format: tx.paymentFormat,
		hours_from_start: tx.hoursFromStart,
		is_cross_bank: tx.isCrossBank,
		is_cross_currency: tx.isCrossCurrency,
		is_self_transfer: tx.isSelfTransfer,
		// Placeholder -- currently just mirrors isLaundering until real ML scoring exists.
		fraud_risk_score: tx.fraudRiskScore,
		sender: toRawParty(tx.sender),
		receiver: toRawParty(tx.receiver),
	};
}

// No risk/status field exists on the backend Cluster model yet --
// leaving them unset lets adaptCluster fall back to its own
// SAMPLE_GRAPH_RISKS placeholder and "Pending" default.
/** @param {import("../api/contracts").Cluster} cluster */
export function toRawCluster(cluster) {
	return {
		cluster_id: cluster.clusterId,
		num_accounts: cluster.numAccounts,
		num_transactions: cluster.numTransactions,
		// Maps to the same `risk` key adaptCluster() reads for both the
		// sidebar's Risk % column and the graph badge -- no other file needs
		// to change for this to show up.
		risk: cluster.riskScore,
		transactions: (cluster.transactions ?? []).map(toRawTransaction),
	};
}

/** @param {import("../api/contracts").ClusterListResponse} response */
export function toRawClusterList(response) {
	return {
		total_clusters: response.totalClusters,
		clusters: (response.clusters ?? []).map(toRawCluster),
	};
}
