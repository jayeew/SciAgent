import { StatusCodes } from 'http-status-codes'
import { INodeParams } from 'flowise-components'
import { ChatFlow } from '../database/entities/ChatFlow'
import { getRunningExpressApp } from '../utils/getRunningExpressApp'
import { IUploadFileSizeAndTypes, IReactFlowNode, IReactFlowEdge } from '../Interface'
import { InternalFlowiseError } from '../errors/internalFlowiseError'

type IUploadConfig = {
    isSpeechToTextEnabled: boolean
    isImageUploadAllowed: boolean
    isRAGFileUploadAllowed: boolean
    imgUploadSizeAndTypes: IUploadFileSizeAndTypes[]
    fileUploadSizeAndTypes: IUploadFileSizeAndTypes[]
    imageUploadHint?: string
}

const DEFAULT_IMAGE_UPLOAD_TYPES = ['image/gif', 'image/jpeg', 'image/png', 'image/webp']
const DEFAULT_IMAGE_UPLOAD_MAX_SIZE_MB = 5
const DOUBAO_VIDEO_IMAGE_UPLOAD_HINT = 'Doubao Video 上传提示：最多上传两张图片，第一张=首帧，第二张=尾帧。'

const enableImageUploads = (imgUploadSizeAndTypes: IUploadFileSizeAndTypes[]) => {
    if (imgUploadSizeAndTypes.length === 0) {
        imgUploadSizeAndTypes.push({
            fileTypes: DEFAULT_IMAGE_UPLOAD_TYPES,
            maxUploadSize: DEFAULT_IMAGE_UPLOAD_MAX_SIZE_MB
        })
    }
}

const hasConnectedDoubaoMediaModelWithImageInput = (nodes: IReactFlowNode[], edges: IReactFlowEdge[]): boolean => {
    const mediaConversationNodeIds = new Set(nodes.filter((node) => node.data.name === 'mediaConversationChain').map((node) => node.id))

    if (mediaConversationNodeIds.size === 0) return false

    return edges.some((edge) => {
        if (!mediaConversationNodeIds.has(edge.target)) return false

        const sourceNode = nodes.find((node) => node.id === edge.source)
        return (
            sourceNode?.data.name === 'doubaoImage' ||
            sourceNode?.data.type === 'DoubaoImage' ||
            sourceNode?.data.name === 'doubaoVideo' ||
            sourceNode?.data.type === 'DoubaoVideo'
        )
    })
}

const hasConnectedDoubaoVideoWithImageInput = (nodes: IReactFlowNode[], edges: IReactFlowEdge[]): boolean => {
    const hasAgentflowDoubaoVideoTool = nodes.some((node) => {
        if (node.data.category !== 'Agent Flows') return false

        if (node.data.name === 'toolAgentflow') {
            return node.data.inputs?.toolAgentflowSelectedTool === 'doubaoVideoTool'
        }

        if (node.data.name === 'agentAgentflow' && Array.isArray(node.data.inputs?.agentTools)) {
            return node.data.inputs.agentTools.some((tool: Record<string, any>) => tool?.agentSelectedTool === 'doubaoVideoTool')
        }

        return false
    })

    if (hasAgentflowDoubaoVideoTool) {
        return true
    }

    const mediaConversationNodeIds = new Set(nodes.filter((node) => node.data.name === 'mediaConversationChain').map((node) => node.id))

    if (mediaConversationNodeIds.size === 0) return false

    return edges.some((edge) => {
        if (!mediaConversationNodeIds.has(edge.target)) return false

        const sourceNode = nodes.find((node) => node.id === edge.source)
        return sourceNode?.data.name === 'doubaoVideo' || sourceNode?.data.type === 'DoubaoVideo'
    })
}

/**
 * Method that checks if uploads are enabled in the chatflow
 * @param {string} chatflowid
 */
export const utilGetUploadsConfig = async (chatflowid: string): Promise<IUploadConfig> => {
    const appServer = getRunningExpressApp()
    const chatflow = await appServer.AppDataSource.getRepository(ChatFlow).findOneBy({
        id: chatflowid
    })
    if (!chatflow) {
        throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${chatflowid} not found`)
    }

    const flowObj = JSON.parse(chatflow.flowData)
    const nodes: IReactFlowNode[] = flowObj.nodes
    const edges: IReactFlowEdge[] = flowObj.edges

    let isSpeechToTextEnabled = false
    let isImageUploadAllowed = false
    let isRAGFileUploadAllowed = false
    let imageUploadHint: string | undefined

    /*
     * Check for STT
     */
    if (chatflow.speechToText) {
        const speechToTextProviders = JSON.parse(chatflow.speechToText)
        for (const provider in speechToTextProviders) {
            if (provider !== 'none') {
                const providerObj = speechToTextProviders[provider]
                if (providerObj.status) {
                    isSpeechToTextEnabled = true
                    break
                }
            }
        }
    }

    /*
     * Condition for isRAGFileUploadAllowed
     * 1.) vector store with fileUpload = true && connected to a document loader with fileType
     */
    const fileUploadSizeAndTypes: IUploadFileSizeAndTypes[] = []
    for (const node of nodes) {
        if (node.data.category === 'Vector Stores' && node.data.inputs?.fileUpload) {
            // Get the connected document loader node fileTypes
            const sourceDocumentEdges = edges.filter(
                (edge) => edge.target === node.id && edge.targetHandle === `${node.id}-input-document-Document`
            )
            for (const edge of sourceDocumentEdges) {
                const sourceNode = nodes.find((node) => node.id === edge.source)
                if (!sourceNode) continue
                const fileType = sourceNode.data.inputParams.find((param) => param.type === 'file' && param.fileType)?.fileType
                if (fileType) {
                    fileUploadSizeAndTypes.push({
                        fileTypes: fileType.split(', '),
                        maxUploadSize: 500
                    })
                    isRAGFileUploadAllowed = true
                }
            }
            break
        }
    }

    /*
     * Condition for isImageUploadAllowed
     * 1.) one of the imgUploadAllowedNodes exists
     * 2.) one of the imgUploadLLMNodes exists + allowImageUploads is ON
     */
    const imgUploadSizeAndTypes: IUploadFileSizeAndTypes[] = []
    const imgUploadAllowedNodes = [
        'llmChain',
        'conversationChain',
        'reactAgentChat',
        'conversationalAgent',
        'toolAgent',
        'supervisor',
        'seqStart'
    ]

    const isAgentflow = nodes.some((node) => node.data.category === 'Agent Flows')

    if (isAgentflow) {
        // check through all the nodes and check if any of the nodes data inputs agentModelConfig or llmModelConfig or conditionAgentModelConfig has allowImageUploads
        nodes.forEach((node) => {
            if (node.data.category === 'Agent Flows') {
                if (
                    node.data.inputs?.agentModelConfig?.allowImageUploads ||
                    node.data.inputs?.llmModelConfig?.allowImageUploads ||
                    node.data.inputs?.conditionAgentModelConfig?.allowImageUploads
                ) {
                    enableImageUploads(imgUploadSizeAndTypes)
                    isImageUploadAllowed = true
                }
            }
        })
    } else {
        if (nodes.some((node) => imgUploadAllowedNodes.includes(node.data.name))) {
            nodes.forEach((node: IReactFlowNode) => {
                const data = node.data
                if (data.category === 'Chat Models' && data.inputs?.['allowImageUploads'] === true) {
                    // TODO: for now the maxUploadSize is hardcoded to 5MB, we need to add it to the node properties
                    node.data.inputParams.map((param: INodeParams) => {
                        if (param.name === 'allowImageUploads' && node.data.inputs?.['allowImageUploads']) {
                            enableImageUploads(imgUploadSizeAndTypes)
                            isImageUploadAllowed = true
                        }
                    })
                }
            })
        }
    }

    if (!isImageUploadAllowed && hasConnectedDoubaoMediaModelWithImageInput(nodes, edges)) {
        enableImageUploads(imgUploadSizeAndTypes)
        isImageUploadAllowed = true
    }

    if (isImageUploadAllowed && hasConnectedDoubaoVideoWithImageInput(nodes, edges)) {
        imageUploadHint = DOUBAO_VIDEO_IMAGE_UPLOAD_HINT
    }

    return {
        isSpeechToTextEnabled,
        isImageUploadAllowed,
        isRAGFileUploadAllowed,
        imgUploadSizeAndTypes,
        fileUploadSizeAndTypes,
        ...(imageUploadHint ? { imageUploadHint } : {})
    }
}
