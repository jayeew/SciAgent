import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'token_usage_credential_call' })
export class TokenUsageCredentialCall {
    @PrimaryColumn({ type: 'varchar', length: 36 })
    id: string

    @Column({ nullable: false })
    usageExecutionId: string

    @Column({ nullable: false })
    tokenUsageCredentialId: string

    @Column({ nullable: false })
    workspaceId: string

    @Column({ nullable: false })
    organizationId: string

    @Column({ nullable: true })
    userId?: string

    @Column({ type: 'int', default: 0 })
    sequenceIndex: number

    @Column({ type: 'varchar', length: 20, default: 'estimated' })
    attributionMode: string

    @Column({ type: 'varchar', length: 32 })
    billingMode: string

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

    @Column({ type: 'int', default: 0 })
    imageCount: number

    @Column({ type: 'int', default: 0 })
    videoCount: number

    @Column({ type: 'int', default: 0 })
    seconds: number

    @Column({ type: 'int', default: 0 })
    characters: number

    @Column({ type: 'text', nullable: true })
    usageBreakdown?: string

    @Column({ type: 'int', default: 0 })
    chargedCredit: number

    @Column({ nullable: true })
    creditTransactionId?: string

    @Column({ nullable: true })
    creditedAt?: Date

    @CreateDateColumn()
    createdDate?: Date
}
