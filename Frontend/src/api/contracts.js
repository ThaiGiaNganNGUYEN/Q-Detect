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
 * @typedef {Object} ApiErrorShape
 * @property {number} status
 * @property {string} message
 * @property {unknown} [details]
 */

export {};
