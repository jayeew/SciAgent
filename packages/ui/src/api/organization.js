import client from './client'

const getWorldMessage = () => client.get('/organization/world-message')
const getWorldMessageManage = () => client.get('/organization/world-message/manage')
const updateWorldMessageDraft = (body) => client.put('/organization/world-message/draft', body)
const publishWorldMessage = () => client.post('/organization/world-message/publish')
const unpublishWorldMessage = () => client.post('/organization/world-message/unpublish')

export default {
    getWorldMessage,
    getWorldMessageManage,
    updateWorldMessageDraft,
    publishWorldMessage,
    unpublishWorldMessage
}
