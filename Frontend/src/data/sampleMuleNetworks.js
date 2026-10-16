import {
	CLUSTER_0_LAYOUT,
	CLUSTER_0_ROUTES,
	sampleClustersResponse,
} from "./sampleClustersApi";

const SAMPLE_GRAPH_RISKS = [89, 95, 87, 96, 88, 97, 73, 89];

function isCashPayment(tx) {
	if (typeof tx.payment_format === "string" && /cash/i.test(tx.payment_format)) {
		return true;
	}
	return Boolean(tx.sender?.id && tx.receiver?.id && tx.sender.id === tx.receiver.id);
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

	const ensureCashOut = (senderId) => {
		const cashId = `cashout-${senderId}`;
		if (accountMap.has(cashId)) {
			return cashId;
		}
		const fixed = layout?.[cashId];
		accountMap.set(cashId, {
			id: cashId,
			kind: "cashout",
			label: "Cash-Out",
			lastName: "Cash-Out",
			fx: fixed?.x,
			fy: fixed?.y,
		});
		return cashId;
	};

	const links = [];
	const tableTransactions = [];

	for (const tx of cluster.transactions ?? []) {
		ensureAccount(tx.sender);
		const cash = isCashPayment(tx);
		const route = routes?.[tx.id] ?? routes?.[String(tx.id)] ?? (cash ? "cashout" : null);

		if (cash) {
			const cashId = ensureCashOut(tx.sender.id);
			links.push({
				source: tx.sender.id,
				target: cashId,
				txId: tx.id,
				amount: formatAmount(tx.amount),
				ref: `Tr-Id ${tx.id}`,
				isCashOut: true,
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
			toLabel: cash ? "" : formatParty(tx.receiver),
			isCashOut: cash,
		});
	}

	const uniqueAccountCount =
		cluster.num_accounts ??
		[...accountMap.values()].filter((node) => node.kind === "account").length;
	const letter = String.fromCharCode(65 + (Number(cluster.cluster_id) || 0));

	return {
		id: String(cluster.cluster_id),
		cluster_id: cluster.cluster_id,
		letter,
		name: `Graph ${letter}`,
		risk: cluster.risk ?? SAMPLE_GRAPH_RISKS[cluster.cluster_id] ?? 0,
		status: cluster.status ?? "Pending",
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
