---
id: invoice-riverside
type: invoice-draft
client: Riverside Studio
quantity: 4
---

## Riverside Studio — Invoice

Rate per hour: `rate=200`
Subtotal: `subtotal=rate*quantity as currency`
With 8% tax: `=subtotal*1.08 as currency`

!view invoice select client, total

Total across all invoices: `=sum(T1.total) as currency`
