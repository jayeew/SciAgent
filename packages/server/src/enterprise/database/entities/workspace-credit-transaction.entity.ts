import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

export enum WorkspaceCreditTransactionType {
    TOPUP = 'topup',
    CONSUME = 'consume',
    ADJUST = 'adjust'
}

@Entity({ name: 'workspace_credit_transaction' })
export class WorkspaceCreditTransaction {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column({ nullable: false })
    workspaceId: string

    @Column({ nullable: false })
    userId: string

    @Column({ type: 'varchar', length: 20 })
    type: string

    // Positive for gains, negative for consumption
    @Column({ type: 'int' })
    amount: number

    @Column({ type: 'int' })
    balance: number

    @Column({ type: 'varchar', length: 255, nullable: true })
    credentialName?: string

    @Column({ nullable: true })
    credentialId?: string

    @Column({ type: 'text', nullable: true })
    description?: string

    @CreateDateColumn()
    createdDate?: Date
}
