/**
 * Frontend API contracts for Q-Detect.
 * Backend teams can match these request/response shapes.
 *
 * Endpoints (relative to VITE_API_BASE_URL):
 * - POST /auth/login
 * - POST /auth/register
 * - GET  /auth/me
 * - PATCH /auth/me
 * - POST /auth/change-password
 * - PATCH /graphs/:graphId/status
 * (served by Backend/routers/cluster_router.py -- api/clusters.js calls these)
 * - GET  /api/graph
 * - GET  /api/graph/cluster/:clusterId
 * - GET  /api/clusters
 * - GET  /api/clusters/:clusterId
 * - GET  /api/accounts/:accountId/cluster
 * (frontend contract for storing a graph note; api/notes.js calls these)
 * - GET  /api/clusters/:clusterId/notes
 * - POST /api/clusters/:clusterId/notes
 *
 * Client-only fields (never sent):
 * - register retype password
 * - change-password confirm new password
 *
 * @typedef {"Pending" | "Safe" | "Fraud"} GraphStatus
 *
 * @typedef {Object} User
 * @property {string} id
 * @property {string} email
 * @property {string} username
 * @property {string} [displayName]
 *
 * @typedef {Object} AuthSession
 * @property {string} [token]
 * @property {User} [user]
 *
 * @typedef {Object} LoginRequest
 * @property {string} email
 * @property {string} password
 *
 * @typedef {AuthSession} LoginResponse
 *
 * @typedef {Object} RegisterRequest
 * @property {string} email
 * @property {string} username
 * @property {string} password
 *
 * @typedef {AuthSession} RegisterResponse
 *
 * @typedef {Object} MeResponse
 * @property {User} user
 *
 * @typedef {Object} UpdateAccountRequest
 * @property {string} username
 * @property {string} email
 * @property {string} displayName
 *
 * @typedef {Object} UpdateAccountResponse
 * @property {User} user
 *
 * @typedef {Object} ChangePasswordRequest
 * @property {string} currentPassword
 * @property {string} newPassword
 *
 * @typedef {Object} ChangePasswordResponse
 * @property {boolean} ok
 *
 * @typedef {Object} UpdateGraphStatusRequest
 * @property {GraphStatus} status
 *
 * @typedef {Object} UpdateGraphStatusResponse
 * @property {string} id
 * @property {GraphStatus} status
 *
 * @typedef {Object} GraphNoteRequest
 * @property {string} note
 *
 * @typedef {Object} GraphNote
 * @property {string|number} clusterId
 * @property {string} note
 *
 * @typedef {Object} ApiErrorShape
 * @property {number} status
 * @property {string} message
 * @property {unknown} [details]
 *
 * ---- Graph / cluster data classes -----------------------------------
 * Mirror Backend/models/{account,transaction,graph,cluster}.py field-for-
 * field, so a change on either side is easy to spot as a shape mismatch.
 *
 * @typedef {Object} Account
 * @property {string} accountId
 * @property {string} bank
 * @property {string} accountNumber
 *
 * @typedef {Object} TransactionRead
 * @property {string} transactionId
 * @property {number} amountPaid
 * @property {string} currencyPaid
 * @property {string} paymentFormat
 * @property {string} timestamp
 * @property {number} hoursFromStart
 * @property {boolean} isCrossBank
 * @property {boolean} isCrossCurrency
 * @property {boolean} isSelfTransfer
 * @property {number} fraudRiskScore 0.0-1.0 fraud probability. Placeholder -- currently just mirrors isLaundering (0.0/1.0) until real ML scoring exists.
 * @property {Account} sender
 * @property {Account} receiver
 *
 * @typedef {Object} Cluster
 * @property {number} clusterId
 * @property {number} numAccounts
 * @property {number} numTransactions
 * @property {number} riskScore 0-100, % of transactions flagged by fraudRiskScore
 * @property {TransactionRead[]} transactions
 *
 * @typedef {Object} ClusterListResponse
 * @property {number} totalClusters
 * @property {Cluster[]} clusters
 *
 * @typedef {Object} GraphNode
 * @property {string} id
 * @property {string} bank
 * @property {string} accountNumber
 *
 * @typedef {Object} GraphEdge
 * @property {string} id
 * @property {string} source
 * @property {string} target
 * @property {number} amount
 * @property {string} currency
 * @property {string} paymentFormat
 * @property {string} timestamp
 * @property {number} hoursFromStart
 * @property {boolean} isCrossBank
 * @property {boolean} isCrossCurrency
 * @property {boolean} isSelfTransfer
 *
 * @typedef {Object} GraphResponse
 * @property {number} numNodes
 * @property {number} numEdges
 * @property {GraphNode[]} nodes
 * @property {GraphEdge[]} edges
 */

export {};
