import {
    ImageDetail,
    IVisionChatModal,
    ICommonObject,
    IFileUpload,
    IMultiModalOption,
    INodeData,
    MessageContentImageUrl
} from './Interface'
import { getFileFromStorage } from './storageUtils'

export const KIMI_CHAT_PROVIDER = 'chatKimi'

const KIMI_VISION_MODEL_REGEX = /^(kimi-k2\.5|moonshot-v1-(8k|32k|128k)-vision-preview)$/

export const isKimiVisionModel = (provider?: string, modelName?: string) =>
    provider === KIMI_CHAT_PROVIDER && !!modelName && KIMI_VISION_MODEL_REGEX.test(modelName)

export const buildImageUrlMessage = (
    url: string,
    imageResolution?: ImageDetail,
    provider?: string,
    modelName?: string
): MessageContentImageUrl => ({
    type: 'image_url',
    image_url: isKimiVisionModel(provider, modelName)
        ? {
              url
          }
        : {
              url,
              detail: imageResolution ?? 'low'
          }
})

export const validateImageUpload = (upload: IFileUpload, provider?: string, modelName?: string) => {
    if (upload.type === 'url' && isKimiVisionModel(provider, modelName)) {
        throw new Error('ChatKimi vision models do not support remote image URLs. Please upload a local image file instead.')
    }
}

export const addImagesToMessages = async (
    nodeData: INodeData,
    options: ICommonObject,
    multiModalOption?: IMultiModalOption
): Promise<MessageContentImageUrl[]> => {
    const imageContent: MessageContentImageUrl[] = []
    let model = nodeData.inputs?.model
    const imageOptions = multiModalOption?.image ?? {}
    const provider = imageOptions.provider as string | undefined
    const modelName = (imageOptions.modelName as string | undefined) ?? model?.configuredModel

    if (llmSupportsVision(model) && multiModalOption) {
        // Image Uploaded
        if (multiModalOption.image && multiModalOption.image.allowImageUploads && options?.uploads && options?.uploads.length > 0) {
            const imageUploads = getImageUploads(options.uploads)
            for (const upload of imageUploads) {
                let bf = upload.data
                if (upload.type == 'stored-file') {
                    const contents = await getFileFromStorage(upload.name, options.orgId, options.chatflowid, options.chatId)
                    // as the image is stored in the server, read the file and convert it to base64
                    bf = 'data:' + upload.mime + ';base64,' + contents.toString('base64')

                    imageContent.push(buildImageUrlMessage(bf, imageOptions.imageResolution, provider, modelName))
                } else if (upload.type == 'url' && bf) {
                    validateImageUpload(upload, provider, modelName)
                    imageContent.push(buildImageUrlMessage(bf, imageOptions.imageResolution, provider, modelName))
                }
            }
        }
    }
    return imageContent
}

export const getAudioUploads = (uploads: IFileUpload[]) => {
    return uploads.filter((upload: IFileUpload) => upload.mime.startsWith('audio/'))
}

export const getImageUploads = (uploads: IFileUpload[]) => {
    return uploads.filter((upload: IFileUpload) => upload.mime.startsWith('image/'))
}

export const llmSupportsVision = (value: any): value is IVisionChatModal => !!value?.multiModalOption
