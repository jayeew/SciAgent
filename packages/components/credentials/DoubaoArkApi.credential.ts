import { INodeCredential, INodeParams } from '../src/Interface'

class DoubaoArkApi implements INodeCredential {
    label: string
    name: string
    version: number
    inputs: INodeParams[]

    constructor() {
        this.label = 'Doubao Ark API'
        this.name = 'doubaoArkApi'
        this.version = 1.0
        this.inputs = [
            {
                label: 'ARK API Key',
                name: 'arkApiKey',
                type: 'password'
            },
            {
                label: 'Base URL',
                name: 'baseUrl',
                type: 'string',
                optional: true,
                placeholder: 'https://ark.cn-beijing.volces.com/api/v3'
            }
        ]
    }
}

module.exports = { credClass: DoubaoArkApi }
