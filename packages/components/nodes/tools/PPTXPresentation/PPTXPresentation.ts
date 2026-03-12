import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { createPPTXPresentationTools, SlideSizeSchema, ThemePresetSchema } from './core'

class PPTXPresentation_Tools implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]

    constructor() {
        this.label = 'PPTX Presentation'
        this.name = 'pptxPresentationTool'
        this.version = 1.0
        this.type = 'PPTXPresentation'
        this.icon = 'powerpoint.svg'
        this.category = 'Tools'
        this.description = 'Generate a real downloadable .pptx presentation from a structured presentation specification'
        this.baseClasses = [this.type, 'Tool']
        this.inputs = [
            {
                label: 'Theme Preset',
                name: 'themePreset',
                type: 'options',
                options: ThemePresetSchema.options.map((option) => ({
                    label: option,
                    name: option
                })),
                default: 'business-neutral',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Slide Size',
                name: 'slideSize',
                type: 'options',
                options: SlideSizeSchema.options.map((option) => ({
                    label: option,
                    name: option
                })),
                default: 'wide',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Include Speaker Notes',
                name: 'includeSpeakerNotes',
                type: 'boolean',
                default: true,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Output File Name',
                name: 'outputFileName',
                type: 'string',
                optional: true,
                additionalParams: true
            }
        ]
    }

    async init(nodeData: INodeData): Promise<any> {
        const defaultParams = this.transformNodeInputsToToolArgs(nodeData)
        return createPPTXPresentationTools({ defaultParams })
    }

    transformNodeInputsToToolArgs(nodeData: INodeData): Record<string, any> {
        const nodeInputs: Record<string, any> = {}

        if (nodeData.inputs?.themePreset) nodeInputs.themePreset = nodeData.inputs.themePreset
        if (nodeData.inputs?.slideSize) nodeInputs.slideSize = nodeData.inputs.slideSize
        if (nodeData.inputs?.outputFileName) nodeInputs.outputFileName = nodeData.inputs.outputFileName
        if (nodeData.inputs?.includeSpeakerNotes !== undefined) nodeInputs.includeSpeakerNotes = nodeData.inputs.includeSpeakerNotes

        return nodeInputs
    }
}

module.exports = { nodeClass: PPTXPresentation_Tools }
