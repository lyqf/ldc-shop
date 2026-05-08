'use client'

import { useI18n } from "@/lib/i18n/context"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { addCards, deleteCard } from "@/actions/admin"
import { toast } from "sonner"
import { CopyButton } from "@/components/copy-button"
import { Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"

interface CardData {
    id: number
    cardKey: string
}

interface CardsContentProps {
    productId: string
    productName: string
    unusedCards: CardData[]
}

export function CardsContent({ productId, productName, unusedCards }: CardsContentProps) {
    const { t } = useI18n()
    const router = useRouter()

    const handleSubmit = async (formData: FormData) => {
        const files = formData
            .getAll('cards_file')
            .filter((x): x is File => x instanceof File && x.size > 0)
        const text = ((formData.get('cards') as string) ?? '').trim()
        if (files.length === 0 && !text) {
            toast.error(t('admin.cards.needInput'))
            return
        }
        try {
            await addCards(formData)
            toast.success(t('common.success'))
            router.refresh()
        } catch (e: any) {
            toast.error(e.message)
        }
    }

    return (
        <div className="space-y-8 max-w-4xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t('admin.cards.title')}: {productName}</h1>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-bold">{unusedCards.length}</div>
                    <div className="text-xs text-muted-foreground">{t('admin.cards.available')}</div>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
                <Card>
                    <CardHeader>
                        <CardTitle>{t('admin.cards.addCards')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form action={handleSubmit} className="space-y-4">
                            <input type="hidden" name="product_id" value={productId} />
                            <div className="space-y-2">
                                <Input
                                    type="file"
                                    name="cards_file"
                                    multiple
                                    accept=".txt,.json,.jsonl,text/plain,application/json"
                                    className="cursor-pointer font-mono text-sm"
                                />
                                <p className="text-xs text-muted-foreground">{t('admin.cards.fileHint')}</p>
                            </div>
                            <Textarea
                                name="cards"
                                placeholder={t('admin.cards.placeholder')}
                                rows={10}
                                className="font-mono text-sm"
                            />
                            <Button type="submit" className="w-full">{t('common.add')}</Button>
                        </form>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>{t('admin.cards.available')}</CardTitle>
                    </CardHeader>
                    <CardContent className="max-h-[400px] overflow-y-auto space-y-2">
                        {unusedCards.length === 0 ? (
                            <div className="text-center py-10 text-muted-foreground text-sm">{t('admin.cards.noCards')}</div>
                        ) : (
                            unusedCards.map(c => (
                                <div key={c.id} className="flex items-center justify-between p-2 rounded bg-muted/40 text-sm font-mono gap-2">
                                    <CopyButton text={c.cardKey} truncate maxLength={30} />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={async () => {
                                            if (confirm(t('common.confirm') + '?')) {
                                                try {
                                                    await deleteCard(c.id)
                                                    toast.success(t('common.success'))
                                                    router.refresh()
                                                } catch (e: any) {
                                                    toast.error(e.message)
                                                }
                                            }
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
