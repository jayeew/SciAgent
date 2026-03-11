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
            }
        ]
    }
}

module.exports = { credClass: AlibabaSTTApi }
