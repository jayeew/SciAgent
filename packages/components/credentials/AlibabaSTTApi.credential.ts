import { INodeParams, INodeCredential } from '../src/Interface'

class AlibabaSTTApi implements INodeCredential {
    label: string
    name: string
    version: number
    inputs: INodeParams[]

    constructor() {
        this.label = 'Alibaba STT API'
        this.name = 'alibabaSTTApi'
        this.version = 1.0
        this.inputs = [
            {
                label: 'Alibaba Api Key',
                name: 'alibabaApiKey',
                type: 'password'
            },
            {
                label: 'Input RMB/s',
                name: 'inputRmbPerSecond',
                type: 'number',
                step: 0.01,
                default: 0,
                description: 'Speech-to-text billing unit price in RMB per second.'
            }
        ]
    }
}

module.exports = { credClass: AlibabaSTTApi }
