import type {
  CompanyDto,
  ContactDto,
  DealDto,
  FulfillmentStatusName,
  OrderDto,
  OrderSummaryDto,
  PaymentStatusName,
  PublicUser
} from "@shilabs/shared-types";
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Eye,
  PackageCheck,
  PackageOpen,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Trash2
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, Drawer, Modal, Select } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";
import {
  createOrder,
  getOrder,
  getOrderSummary,
  listCompanies,
  listContacts,
  listDeals,
  listOrders,
  listUsers,
  updateOrder,
  type OrderItemBody
} from "../../services/api-client.js";

const paymentOptions: { value: PaymentStatusName | ""; label: string }[] = [
  { value: "", label: "All payments" },
  { value: "PENDING", label: "Pending" },
  { value: "PARTIALLY_PAID", label: "Partially paid" },
  { value: "PAID", label: "Paid" },
  { value: "FAILED", label: "Failed" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "CANCELED", label: "Canceled" }
];
const fulfillmentOptions: { value: FulfillmentStatusName | ""; label: string }[] = [
  { value: "", label: "All fulfillment" },
  { value: "UNFULFILLED", label: "Unfulfilled" },
  { value: "PROCESSING", label: "Processing" },
  { value: "FULFILLED", label: "Fulfilled" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "CANCELED", label: "Canceled" }
];

interface OrdersData {
  orders: OrderDto[];
  summary: OrderSummaryDto;
  companies: CompanyDto[];
  contacts: ContactDto[];
  deals: DealDto[];
  users: PublicUser[];
  total: number;
  totalPages: number;
}

function displayStatus(status: string): string {
  return status.toLowerCase().replaceAll("_", " ");
}
function money(value: string, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number(value));
}
function date(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
function paymentTone(status: PaymentStatusName): "success" | "danger" | "warning" | "neutral" {
  if (status === "PAID") return "success";
  if (status === "FAILED" || status === "CANCELED" || status === "REFUNDED") return "danger";
  if (status === "PARTIALLY_PAID") return "warning";
  return "neutral";
}
function fulfillmentTone(
  status: FulfillmentStatusName
): "success" | "danger" | "warning" | "neutral" {
  if (status === "FULFILLED") return "success";
  if (status === "CANCELED") return "danger";
  if (status === "PROCESSING" || status === "ON_HOLD") return "warning";
  return "neutral";
}

function OrderForm({
  accessToken,
  data,
  order,
  onSaved
}: {
  accessToken: string;
  data: OrdersData;
  order: OrderDto | null;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [companyId, setCompanyId] = useState(order?.companyId ?? data.companies[0]?.id ?? "");
  const [contactId, setContactId] = useState(order?.contactId ?? "");
  const [dealId, setDealId] = useState(order?.dealId ?? "");
  const [ownerId, setOwnerId] = useState(order?.ownerId ?? "");
  const [currency, setCurrency] = useState(order?.currency ?? "INR");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [items, setItems] = useState<OrderItemBody[]>(
    order?.items.map((item) => ({
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice
    })) ?? [{ name: "", quantity: 1, unitPrice: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const companyContacts = data.contacts.filter((contact) => contact.companyId === companyId);
  const companyDeals = data.deals.filter((deal) => deal.lead.companyId === companyId);
  const setItem = (index: number, patch: Partial<OrderItemBody>): void =>
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    );
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        companyId,
        contactId: contactId || null,
        dealId: dealId || null,
        ownerId: ownerId || null,
        currency,
        notes: notes || null,
        items: items.map((item) => ({ ...item, unitPrice: item.unitPrice || "0" }))
      };
      if (order) await updateOrder(accessToken, order.id, body);
      else await createOrder(accessToken, body);
      await onSaved();
    } catch {
      setError("The order could not be saved. Check the selected CRM records and item values.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="order-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="order-form-grid">
        <label>
          Company
          <Select
            ariaLabel="Order company"
            onChange={(value) => {
              setCompanyId(value);
              setContactId("");
              setDealId("");
            }}
            options={data.companies.map((company) => ({ value: company.id, label: company.name }))}
            value={companyId}
          />
        </label>
        <label>
          Contact
          <Select
            ariaLabel="Order contact"
            onChange={setContactId}
            options={[
              { value: "", label: "No contact" },
              ...companyContacts.map((contact) => ({
                value: contact.id,
                label: `${contact.firstName} ${contact.lastName}`
              }))
            ]}
            value={contactId}
          />
        </label>
        <label>
          Deal
          <Select
            ariaLabel="Related deal"
            onChange={(value) => {
              setDealId(value);
              const deal = data.deals.find((item) => item.id === value);
              if (deal) {
                setCompanyId(deal.lead.companyId);
                setContactId(deal.lead.contactId);
                setOwnerId(deal.ownerId ?? "");
              }
            }}
            options={[
              { value: "", label: "No deal" },
              ...companyDeals.map((deal) => ({
                value: deal.id,
                label: `${deal.lead.company.name} - ${deal.stage.label}`
              }))
            ]}
            value={dealId}
          />
        </label>
        <label>
          Owner
          <Select
            ariaLabel="Order owner"
            onChange={setOwnerId}
            options={[
              { value: "", label: "Unassigned" },
              ...data.users.map((user) => ({
                value: user.id,
                label: `${user.firstName} ${user.lastName}`
              }))
            ]}
            value={ownerId}
          />
        </label>
        <label>
          Currency
          <input
            aria-label="Order currency"
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            value={currency}
          />
        </label>
      </div>
      <section className="order-items-editor">
        <header>
          <strong>Order items</strong>
          <Button
            size="sm"
            onClick={() =>
              setItems((current) => [...current, { name: "", quantity: 1, unitPrice: "" }])
            }
          >
            <Plus size={14} /> Add item
          </Button>
        </header>
        {items.map((item, index) => (
          <div className="order-item-input" key={String(index)}>
            <input
              aria-label={`Item ${String(index + 1)} name`}
              onChange={(event) => setItem(index, { name: event.target.value })}
              placeholder="Item or service"
              required
              value={item.name}
            />
            <input
              aria-label={`Item ${String(index + 1)} quantity`}
              min={1}
              onChange={(event) => setItem(index, { quantity: Number(event.target.value) })}
              required
              type="number"
              value={item.quantity}
            />
            <input
              aria-label={`Item ${String(index + 1)} unit price`}
              min={0}
              onChange={(event) => setItem(index, { unitPrice: event.target.value })}
              placeholder="0.00"
              required
              step="0.01"
              type="number"
              value={item.unitPrice}
            />
            <Button
              aria-label={`Remove item ${String(index + 1)}`}
              disabled={items.length === 1}
              iconOnly
              onClick={() =>
                setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
              size="sm"
              variant="ghost"
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
      </section>
      <label className="order-notes">
        Notes
        <textarea onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
      </label>
      <footer>
        <Button
          disabled={busy || !companyId || items.some((item) => !item.name || !item.unitPrice)}
          type="submit"
          variant="primary"
        >
          {busy ? "Saving" : order ? "Save order" : "Create order"}
        </Button>
      </footer>
    </form>
  );
}

function OrderDetail({
  accessToken,
  order,
  onEdit,
  onSaved
}: {
  accessToken: string;
  order: OrderDto;
  onEdit: () => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatusName>(order.paymentStatus);
  const [fulfillmentStatus, setFulfillmentStatus] = useState<FulfillmentStatusName>(
    order.fulfillmentStatus
  );
  const [busy, setBusy] = useState(false);
  const saveState = async (): Promise<void> => {
    setBusy(true);
    try {
      await updateOrder(accessToken, order.id, { paymentStatus, fulfillmentStatus });
      await onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="order-detail">
      <header className="order-detail-identity">
        <span>
          <ShoppingBag size={20} />
        </span>
        <div>
          <strong>{order.orderNumber}</strong>
          <small>{order.company.name}</small>
        </div>
        <Button onClick={onEdit} size="sm">
          <Pencil size={14} /> Edit
        </Button>
      </header>
      <dl className="order-detail-facts">
        <div>
          <dt>Total</dt>
          <dd>{money(order.total, order.currency)}</dd>
        </div>
        <div>
          <dt>Ordered</dt>
          <dd>{date(order.orderedAt)}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{order.owner ? `${order.owner.firstName} ${order.owner.lastName}` : "Unassigned"}</dd>
        </div>
        <div>
          <dt>Contact</dt>
          <dd>
            {order.contact ? `${order.contact.firstName} ${order.contact.lastName}` : "Not linked"}
          </dd>
        </div>
      </dl>
      <section className="order-state-editor">
        <label>
          Payment
          <Select
            ariaLabel="Payment status"
            onChange={(value) => setPaymentStatus(value as PaymentStatusName)}
            options={paymentOptions.slice(1)}
            value={paymentStatus}
          />
        </label>
        <label>
          Fulfillment
          <Select
            ariaLabel="Fulfillment status"
            onChange={(value) => setFulfillmentStatus(value as FulfillmentStatusName)}
            options={fulfillmentOptions.slice(1)}
            value={fulfillmentStatus}
          />
        </label>
        <Button
          disabled={
            busy ||
            (paymentStatus === order.paymentStatus && fulfillmentStatus === order.fulfillmentStatus)
          }
          onClick={() => void saveState()}
          variant="primary"
        >
          {busy ? "Saving" : "Update state"}
        </Button>
      </section>
      <section className="order-line-items">
        <header>
          <strong>Items</strong>
          <span>{order.items.length}</span>
        </header>
        {order.items.map((item) => (
          <article key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <small>
                {item.description ??
                  `${String(item.quantity)} x ${money(item.unitPrice, order.currency)}`}
              </small>
            </div>
            <span>{String(item.quantity)} x</span>
            <strong>{money(item.lineTotal, order.currency)}</strong>
          </article>
        ))}
        <footer>
          <span>Total</span>
          <strong>{money(order.total, order.currency)}</strong>
        </footer>
      </section>
      <section className="order-links">
        <strong>CRM relationships</strong>
        <a href="/companies">{order.company.name}</a>
        {order.deal ? (
          <a href={`/deals/${encodeURIComponent(order.deal.id)}`}>
            Deal / {order.deal.stage.label}
          </a>
        ) : (
          <span>No deal linked</span>
        )}
        {order.notes ? <p>{order.notes}</p> : null}
      </section>
    </div>
  );
}

export function OrdersWorkspace({
  accessToken,
  initialOrderId,
  onRouteChange
}: {
  accessToken: string;
  initialOrderId: string | null;
  onRouteChange: (orderId: string | null) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatusName | "">("");
  const [fulfillmentStatus, setFulfillmentStatus] = useState<FulfillmentStatusName | "">("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const detailId = initialOrderId ?? selectedId;
  const resource = usePersistedResource<OrdersData>({
    scope: `orders:${search}:${paymentStatus}:${fulfillmentStatus}:${String(page)}`,
    load: async () => {
      const [orders, summary, companies, contacts, deals, users] = await Promise.all([
        listOrders(accessToken, {
          search,
          paymentStatus: paymentStatus || undefined,
          fulfillmentStatus: fulfillmentStatus || undefined,
          page,
          pageSize: 10
        }),
        getOrderSummary(accessToken),
        listCompanies(accessToken),
        listContacts(accessToken),
        listDeals(accessToken, { pageSize: 100 }),
        listUsers(accessToken)
      ]);
      return {
        orders: orders.items,
        summary,
        companies,
        contacts,
        deals: deals.items,
        users,
        total: orders.total,
        totalPages: orders.totalPages
      };
    },
    accepts: (event) =>
      event.type === "realtime:reconnected" ||
      ["order", "deal", "workspace"].includes(event.entityType),
    errorMessage: "Orders could not be loaded."
  });
  const detail = usePersistedResource<OrderDto | null>({
    scope: `order:${detailId ?? "closed"}`,
    load: () => (detailId ? getOrder(accessToken, detailId) : Promise.resolve(null)),
    accepts: (event) => event.type === "realtime:reconnected" || event.entityType === "order",
    errorMessage: "Order details could not be loaded."
  });
  const data = resource.data;
  const metrics = useMemo(
    () =>
      data
        ? ([
            ["Total orders", String(data.summary.totalOrders), ShoppingBag],
            ["Unfulfilled", String(data.summary.unfulfilled), PackageOpen],
            ["Processing", String(data.summary.processing), Clock3],
            ["Fulfilled today", String(data.summary.fulfilledToday), PackageCheck],
            ["Revenue today", money(data.summary.revenueToday, data.summary.currency), Banknote],
            [
              "Average value",
              money(data.summary.averageOrderValue, data.summary.currency),
              CircleDollarSign
            ]
          ] as const)
        : [],
    [data]
  );
  const close = (): void => {
    setSelectedId(null);
    onRouteChange(null);
  };
  const open = (id: string): void => {
    setSelectedId(id);
    onRouteChange(id);
  };
  if (resource.loading && !data)
    return (
      <StateBlock title="Loading order queue" detail="Fetching authorized commercial records." />
    );
  if (resource.error || !data)
    return (
      <StateBlock
        title="Order queue unavailable"
        detail={resource.error ?? "No order data was returned."}
        action={<Button onClick={() => void resource.reload()}>Retry</Button>}
      />
    );
  return (
    <section className="orders-workspace" aria-label="Order queue">
      <header className="orders-heading">
        <div>
          <span className="records-eyebrow">Commerce / Operations</span>
          <h2>Order Queue</h2>
          <p>Track payment and fulfillment without leaving the CRM.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} variant="primary">
          <Plus size={16} /> New order
        </Button>
      </header>
      <section className="order-metrics" aria-label="Order summary">
        {metrics.map(([label, value, Icon]) => (
          <Card className="order-metric" key={label}>
            <span>{label}</span>
            <Icon size={17} />
            <strong>{value}</strong>
          </Card>
        ))}
      </section>
      <Card className="order-queue">
        <div className="order-filters">
          <label>
            <Search size={17} />
            <input
              aria-label="Search orders"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search order, company, or contact"
              value={search}
            />
          </label>
          <Select
            ariaLabel="Payment filter"
            onChange={(value) => {
              setPaymentStatus(value as PaymentStatusName | "");
              setPage(1);
            }}
            options={paymentOptions}
            value={paymentStatus}
          />
          <Select
            ariaLabel="Fulfillment filter"
            onChange={(value) => {
              setFulfillmentStatus(value as FulfillmentStatusName | "");
              setPage(1);
            }}
            options={fulfillmentOptions}
            value={fulfillmentStatus}
          />
        </div>
        {data.orders.length ? (
          <div className="order-table-wrap">
            <div className="order-table-row head">
              <span>Order</span>
              <span>Items</span>
              <span>Total</span>
              <span>Payment</span>
              <span>Fulfillment</span>
              <span>Owner</span>
              <span>Date</span>
              <span aria-label="Actions" />
            </div>
            {data.orders.map((order) => (
              <div className="order-table-row" key={order.id}>
                <button className="order-primary" onClick={() => open(order.id)} type="button">
                  <strong>{order.orderNumber}</strong>
                  <small>{order.company.name}</small>
                </button>
                <span>
                  {order.items.length} / {order.items[0]?.name ?? "No items"}
                </span>
                <strong>{money(order.total, order.currency)}</strong>
                <Badge tone={paymentTone(order.paymentStatus)}>
                  {displayStatus(order.paymentStatus)}
                </Badge>
                <Badge tone={fulfillmentTone(order.fulfillmentStatus)}>
                  {displayStatus(order.fulfillmentStatus)}
                </Badge>
                <span>
                  {order.owner ? `${order.owner.firstName} ${order.owner.lastName}` : "Unassigned"}
                </span>
                <time>{date(order.orderedAt)}</time>
                <Button
                  aria-label={`View ${order.orderNumber}`}
                  iconOnly
                  onClick={() => open(order.id)}
                  size="sm"
                  variant="ghost"
                >
                  <Eye size={16} />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <StateBlock
            title="No orders found"
            detail="Create an order or adjust the current search and filters."
          />
        )}
        <footer className="order-pagination">
          <span>
            Showing {data.orders.length} of {data.total} orders
          </span>
          <div>
            <Button
              aria-label="Previous page"
              disabled={page === 1}
              iconOnly
              onClick={() => setPage((current) => current - 1)}
              size="sm"
            >
              <ChevronLeft size={16} />
            </Button>
            <span>
              Page {page} of {data.totalPages}
            </span>
            <Button
              aria-label="Next page"
              disabled={page >= data.totalPages}
              iconOnly
              onClick={() => setPage((current) => current + 1)}
              size="sm"
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </footer>
      </Card>
      <Drawer open={Boolean(detailId)} onClose={close} title="Order details">
        {detail.loading ? (
          <StateBlock title="Loading order" />
        ) : detail.error || !detail.data ? (
          <StateBlock
            title="Order unavailable"
            detail={detail.error ?? "This order is no longer available."}
          />
        ) : (
          <OrderDetail
            accessToken={accessToken}
            onEdit={() => setEditOpen(true)}
            onSaved={async () => {
              await Promise.all([detail.reload(), resource.reload()]);
            }}
            order={detail.data}
          />
        )}
      </Drawer>
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New order">
        <OrderForm
          accessToken={accessToken}
          data={data}
          onSaved={async () => {
            setCreateOpen(false);
            await resource.reload();
          }}
          order={null}
        />
      </Modal>
      <Modal
        open={editOpen && Boolean(detail.data)}
        onClose={() => setEditOpen(false)}
        title="Edit order"
      >
        {detail.data ? (
          <OrderForm
            accessToken={accessToken}
            data={data}
            onSaved={async () => {
              setEditOpen(false);
              await Promise.all([detail.reload(), resource.reload()]);
            }}
            order={detail.data}
          />
        ) : null}
      </Modal>
    </section>
  );
}
