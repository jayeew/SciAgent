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
            },
            {
                label: 'Input RMB/Image',
                name: 'inputRmbPerImage',
                type: 'number',
                step: 0.01,
                default: 0,
                description: 'Image generation billing unit price in RMB per generated image.'
            }
        ]
    }
}

module.exports = { credClass: DoubaoArkApi }
