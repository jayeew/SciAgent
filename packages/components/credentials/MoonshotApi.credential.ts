import { INodeCredential, INodeParams } from '../src/Interface'

class MoonshotApi implements INodeCredential {
    label: string
    name: string
    version: number
    inputs: INodeParams[]

    constructor() {
        this.label = 'Moonshot API'
        this.name = 'moonshotApi'
        this.version = 1.0
        this.inputs = [
            {
                label: 'Moonshot API Key',
                name: 'moonshotApiKey',
                type: 'password'
            }
        ]
    }
}

module.exports = { credClass: MoonshotApi }
