import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'token_usage_credential' })
export class TokenUsageCredential {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column({ nullable: false })
    usageExecutionId: string

    @Column({ nullable: false })
    workspaceId: string

    @Column({ nullable: false })
    organizationId: string

    @Column({ nullable: true })
    userId?: string

    @Column({ nullable: true })
    credentialId?: string

    @Column({ nullable: true, type: 'varchar', length: 255 })
    credentialName?: string

    @Column({ nullable: true, type: 'varchar', length: 255 })
    model?: string

    @Column({ type: 'int', default: 0 })
    usageCount: number

    @Column({ type: 'int', default: 0 })
    inputTokens: number

    @Column({ type: 'int', default: 0 })
    outputTokens: number

    @Column({ type: 'int', default: 0 })
    totalTokens: number

    @Column({ type: 'int', default: 0 })
    cacheReadTokens: number

    @Column({ type: 'int', default: 0 })
    cacheWriteTokens: number

    @Column({ type: 'int', default: 0 })
    reasoningTokens: number

    @Column({ type: 'int', default: 0 })
    acceptedPredictionTokens: number

    @Column({ type: 'int', default: 0 })
    rejectedPredictionTokens: number

    @Column({ type: 'int', default: 0 })
    audioInputTokens: number

    @Column({ type: 'int', default: 0 })
    audioOutputTokens: number

    @Column({ type: 'text', nullable: true })
    usageBreakdown?: string

    @CreateDateColumn()
    createdDate?: Date
}
