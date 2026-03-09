import { INodeParams, INodeCredential } from '../src/Interface'

class AlibabaTTSApi implements INodeCredential {
    label: string
    name: string
    version: number
    inputs: INodeParams[]

    constructor() {
        this.label = 'Alibaba TTS API'
        this.name = 'alibabaTTSApi'
        this.version = 1.0
        this.inputs = [
            {
                label: 'Alibaba Api Key',
                name: 'alibabaApiKey',
                type: 'password'
            },
            {
                label: 'Input RMB/10k chars',
                name: 'inputRmbPer10kChars',
                type: 'number',
                step: 0.01,
                default: 0,
                description: 'Text-to-speech billing unit price in RMB per 10,000 characters.'
            }
        ]
    }
}

module.exports = { credClass: AlibabaTTSApi }
