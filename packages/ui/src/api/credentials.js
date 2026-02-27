import client from './client'

const getAllCredentials = () => client.get('/credentials')

const getCredentialsByName = (componentCredentialName) => client.get(`/credentials?credentialName=${componentCredentialName}`)

const getAllComponentsCredentials = () => client.get('/components-credentials')

const getSpecificCredential = (id) => client.get(`/credentials/${id}`)

const getSpecificComponentCredential = (name) => client.get(`/components-credentials/${name}`)

const createCredential = (body) => client.post(`/credentials`, body)

const updateCredential = (id, body) => client.put(`/credentials/${id}`, body)
const updateCredentialMultiplier = (id, creditConsumptionMultiplier) =>
    client.patch(`/credentials/${id}/multiplier`, { creditConsumptionMultiplier })

const deleteCredential = (id) => client.delete(`/credentials/${id}`)

export default {
    getAllCredentials,
    getCredentialsByName,
    getAllComponentsCredentials,
    getSpecificCredential,
    getSpecificComponentCredential,
    createCredential,
    updateCredential,
    updateCredentialMultiplier,
    deleteCredential
}
