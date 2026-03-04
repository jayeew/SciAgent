import { llmSupportsVision } from '../../../src/multiModalUtils'

const { nodeClass: ChatAlibabaTongyi_ChatModels } = require('../../../nodes/chatmodels/ChatAlibabaTongyi/ChatAlibabaTongyi')

describe('ChatAlibabaTongyi', () => {
    const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    const baseNodeData = {
        id: 'chatAlibabaTongyi_0',
        inputs: {
            modelName: 'qwen3.5-plus',
            streaming: true,
            alibabaApiKey: 'test-api-key'
        }
    }

    it('should default allowImageUploads to false and keep DashScope baseURL', async () => {
        const node = new ChatAlibabaTongyi_ChatModels()
        const model = await node.init(baseNodeData, '', {})

        expect(llmSupportsVision(model)).toBe(true)
        expect(model.multiModalOption?.image?.allowImageUploads).toBe(false)
        expect(model.multiModalOption?.image?.imageResolution).toBeUndefined()
        expect(model.clientConfig?.baseURL).toBe(DASHSCOPE_BASE_URL)
    })

    it('should set allowImageUploads and imageResolution when enabled', async () => {
        const node = new ChatAlibabaTongyi_ChatModels()
        const model = await node.init(
            {
                ...baseNodeData,
                inputs: {
                    ...baseNodeData.inputs,
                    allowImageUploads: true,
                    imageResolution: 'high'
                }
            },
            '',
            {}
        )

        expect(llmSupportsVision(model)).toBe(true)
        expect(model.multiModalOption?.image?.allowImageUploads).toBe(true)
        expect(model.multiModalOption?.image?.imageResolution).toBe('high')
        expect(model.clientConfig?.baseURL).toBe(DASHSCOPE_BASE_URL)
    })
})
