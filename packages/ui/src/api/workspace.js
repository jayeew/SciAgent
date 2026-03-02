import client from './client'

const getAllWorkspacesByOrganizationId = (organizationId) => client.get(`/workspace?organizationId=${organizationId}`)

const getWorkspaceById = (id) => client.get(`/workspace?id=${id}`)

const unlinkUsers = (id, body) => client.post(`/workspace/unlink-users/${id}`, body)
const linkUsers = (id, body) => client.post(`/workspace/link-users/${id}`, body)

const switchWorkspace = (id) => client.post(`/workspace/switch?id=${id}`)
const getCreditSummary = () => client.get('/workspace/credit')
const getCreditTransactions = (params = {}) => {
    const normalizedParams = typeof params === 'number' ? { pageSize: params } : params
    const search = new URLSearchParams()

    if (typeof normalizedParams.page !== 'undefined') search.set('page', String(normalizedParams.page))
    if (typeof normalizedParams.pageSize !== 'undefined') search.set('pageSize', String(normalizedParams.pageSize))
    if (typeof normalizedParams.limit !== 'undefined' && typeof normalizedParams.pageSize === 'undefined') {
        search.set('pageSize', String(normalizedParams.limit))
    }
    if (normalizedParams.startDate) search.set('startDate', String(normalizedParams.startDate))
    if (normalizedParams.endDate) search.set('endDate', String(normalizedParams.endDate))

    const query = search.toString()
    return client.get(`/workspace/credit/transactions${query ? `?${query}` : ''}`)
}
const topupCredit = (body) => client.post('/workspace/credit/topup', body)
const dailyCheckIn = () => client.post('/workspace/credit/checkin')

const createWorkspace = (body) => client.post(`/workspace`, body)
const updateWorkspace = (body) => client.put(`/workspace`, body)
const deleteWorkspace = (id) => client.delete(`/workspace/${id}`)

const getSharedWorkspacesForItem = (id) => client.get(`/workspace/shared/${id}`)
const setSharedWorkspacesForItem = (id, body) => client.post(`/workspace/shared/${id}`, body)

const updateWorkspaceUserRole = (body) => client.put(`/workspaceuser`, body)

export default {
    getAllWorkspacesByOrganizationId,
    getWorkspaceById,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    unlinkUsers,
    linkUsers,
    switchWorkspace,
    getCreditSummary,
    getCreditTransactions,
    topupCredit,
    dailyCheckIn,
    getSharedWorkspacesForItem,
    setSharedWorkspacesForItem,

    updateWorkspaceUserRole
}
