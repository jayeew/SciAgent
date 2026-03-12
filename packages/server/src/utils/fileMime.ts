import path from 'path'

export const getContentTypeFromFileName = (fileName: string): string | undefined => {
    const extension = path.extname(fileName).toLowerCase()

    switch (extension) {
        case '.png':
            return 'image/png'
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg'
        case '.gif':
            return 'image/gif'
        case '.webp':
            return 'image/webp'
        case '.svg':
            return 'image/svg+xml'
        case '.mp4':
            return 'video/mp4'
        case '.webm':
            return 'video/webm'
        case '.mov':
            return 'video/quicktime'
        case '.avi':
            return 'video/x-msvideo'
        case '.ppt':
            return 'application/vnd.ms-powerpoint'
        case '.pptx':
            return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        default:
            return undefined
    }
}
