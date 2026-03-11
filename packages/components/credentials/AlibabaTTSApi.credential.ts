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
            }
        ]
    }
}

module.exports = { credClass: AlibabaTTSApi }
