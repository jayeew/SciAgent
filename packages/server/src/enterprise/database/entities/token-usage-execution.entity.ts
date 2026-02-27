import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'token_usage_execution' })
export class TokenUsageExecution {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column({ nullable: false })
    workspaceId: string

    @Column({ nullable: false })
    organizationId: string

    @Column({ nullable: true })
    userId?: string

    @Column({ type: 'varchar', length: 32 })
    flowType: string

    @Column({ nullable: true })
    flowId?: string

    @Column({ nullable: true })
    executionId?: string

    @Column({ nullable: true, type: 'varchar', length: 255 })
    chatId?: string

    @Column({ nullable: true })
    chatMessageId?: string

    @Column({ nullable: true, type: 'varchar', length: 255 })
    sessionId?: string

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

    @Column({ type: 'text', nullable: true })
    modelBreakdown?: string

    @CreateDateColumn()
    createdDate?: Date
}
