import {
	CLUSTER_0_LAYOUT,
	CLUSTER_0_ROUTES,
	sampleClustersResponse,
} from "./sampleClustersApi";

const SAMPLE_GRAPH_RISKS = [89, 95, 87, 96, 88, 97, 73, 89];

const SELF_TRANSFER_LABEL = "Self-transfer";

// A payment with no separate receiver to draw a line to, so it gets its own
// node. A Cash payment between two different accounts is NOT one of these:
// it's a normal transaction and is drawn between those accounts.
function isSelfPayment(tx) {
	return !tx.receiver?.id || tx.sender?.id === tx.receiver.id;
}

function isCashFormat(tx) {
	return typeof tx.payment_format === "string" && /cash/i.test(tx.payment_format);
}

function formatAmount(amount) {
	return Number(amount).toLocaleString("en-US", {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	});
}

function formatParty(party) {
	if (!party) {
		return "—";
	}
	return `${party.bank}/${party.account_number}`;
}

function partyLabel(party) {
	if (party?.bank && party?.account_number) {
		return `${party.bank}/${party.account_number}`;
	}
	return party?.account_number || party?.id || "Account";
}

/**
 * Transform one API cluster into the dashboard view model
 * (nodes/links for D3 + rows for the transaction table).
 */
export function adaptCluster(cluster, options = {}) {
	// The hand-tuned layout/routes belong to the sample cluster 0 only -- live
	// clusters use real transaction ids, which could collide with the route keys.
	const isSampleCluster0 = cluster.cluster_id === 0 && !cluster.live;
	const layout = options.layout ?? (isSampleCluster0 ? CLUSTER_0_LAYOUT : null);
	const routes = options.routes ?? (isSampleCluster0 ? CLUSTER_0_ROUTES : null);

	const accountMap = new Map();

	const ensureAccount = (party) => {
		if (!party?.id || accountMap.has(party.id)) {
			return;
		}
		const fixed = layout?.[party.id];
		accountMap.set(party.id, {
			id: party.id,
			kind: "account",
			label: partyLabel(party),
			lastName: partyLabel(party),
			bank: party.bank,
			account_number: party.account_number,
			fx: fixed?.x,
			fy: fixed?.y,
		});
	};

	// One node per account, labelled "Cash-Out" or "Self-transfer".
	const ensureSelfPaymentNode = (senderId, label) => {
		const cashId = `cashout-${senderId}`;
		const existing = accountMap.get(cashId);
		if (existing) {
			// An account with both kinds is labelled with the more general one.
			if (existing.label !== label) {
				existing.label = SELF_TRANSFER_LABEL;
				existing.lastName = SELF_TRANSFER_LABEL;
			}
			return cashId;
		}
		const fixed = layout?.[cashId];
		accountMap.set(cashId, {
			id: cashId,
			kind: "cashout",
			label,
			lastName: label,
			fx: fixed?.x,
			fy: fixed?.y,
		});
		return cashId;
	};

	const links = [];
	const tableTransactions = [];

	for (const tx of cluster.transactions ?? []) {
		ensureAccount(tx.sender);
		const selfPayment = isSelfPayment(tx);
		const cashOut = selfPayment && isCashFormat(tx);
		const route = routes?.[tx.id] ?? routes?.[String(tx.id)] ?? (selfPayment ? "cashout" : null);

		if (selfPayment) {
			const cashId = ensureSelfPaymentNode(tx.sender.id, cashOut ? "Cash-Out" : SELF_TRANSFER_LABEL);
			links.push({
				source: tx.sender.id,
				target: cashId,
				txId: tx.id,
				amount: formatAmount(tx.amount),
				ref: `Tr-Id ${tx.id}`,
				isSelfPayment: true,
				isCashOut: cashOut,
				route: route ?? "cashout",
				currency: tx.currency,
				payment_format: tx.payment_format,
				timestamp: tx.timestamp,
				sender: tx.sender,
				receiver: tx.receiver,
			});
		} else {
			ensureAccount(tx.receiver);
			links.push({
				source: tx.sender.id,
				target: tx.receiver.id,
				txId: tx.id,
				amount: formatAmount(tx.amount),
				ref: `Tr-Id ${tx.id}`,
				isSelfPayment: false,
				isCashOut: false,
				route,
				currency: tx.currency,
				payment_format: tx.payment_format,
				timestamp: tx.timestamp,
				sender: tx.sender,
				receiver: tx.receiver,
			});
		}

		tableTransactions.push({
			id: tx.id,
			ref: `Tr-Id ${tx.id}`,
			timestamp: tx.timestamp,
			amount: tx.amount,
			currency: tx.currency,
			payment_format: tx.payment_format ?? "—",
			// Undefined for the static sample data (it predates these fields) --
			// the table renders a placeholder when they're missing.
			hours_from_start: tx.hours_from_start,
			is_cross_bank: tx.is_cross_bank,
			is_cross_currency: tx.is_cross_currency,
			is_self_transfer: tx.is_self_transfer,
			fraud_risk_score: tx.fraud_risk_score,
			sender: tx.sender,
			receiver: tx.receiver,
			fromLabel: formatParty(tx.sender),
			toLabel: cashOut ? "" : formatParty(tx.receiver),
			isSelfPayment: selfPayment,
			isCashOut: cashOut,
		});
	}

	const uniqueAccountCount =
		cluster.num_accounts ??
		[...accountMap.values()].filter((node) => node.kind === "account").length;
	// A live cluster_id is already the graph's stable number. Sample ids start at 0.
	const number = cluster.live ? cluster.cluster_id : (Number(cluster.cluster_id) || 0) + 1;

	return {
		id: String(cluster.cluster_id),
		cluster_id: cluster.cluster_id,
		// Only live graphs are saved. Sample ids could match real graph numbers.
		live: Boolean(cluster.live),
		name: `Graph ${number}`,
		risk: cluster.risk ?? SAMPLE_GRAPH_RISKS[cluster.cluster_id] ?? 0,
		status: cluster.status ?? "Pending",
		hasNewActivity: Boolean(cluster.has_new_activity),
		num_accounts: uniqueAccountCount,
		num_transactions: cluster.num_transactions ?? (cluster.transactions?.length ?? 0),
		nodes: [...accountMap.values()],
		links,
		transactions: tableTransactions,
	};
}

export function adaptClustersResponse(response = sampleClustersResponse) {
	const clusters = (response.clusters ?? []).map((cluster) => adaptCluster(cluster));
	return {
		total_clusters: response.total_clusters ?? clusters.length,
		clusters,
	};
}

const adapted = adaptClustersResponse(sampleClustersResponse);

export const sampleMuleNetworks = adapted.clusters;

export function getMuleNetworkById(id) {
	const key = String(id);
	return sampleMuleNetworks.find((cluster) => cluster.id === key) ?? sampleMuleNetworks[0];
}
