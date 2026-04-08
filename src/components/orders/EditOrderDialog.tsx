import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Order {
  id: string;
  order_id: string;
  order_type: "ecom" | "instant" | "errand";
  voucher_no?: string;
  status: string;
  client_id: string;
  driver_id?: string;
  third_party_id?: string;
  fulfillment?: string;
  order_amount_usd: number;
  order_amount_lbp: number;
  delivery_fee_usd: number;
  delivery_fee_lbp: number;
  amount_due_to_client_usd?: number;
  third_party_fee_usd?: number;
  client_net_usd?: number;
  prepaid_by_runners?: boolean;
  prepaid_by_company?: boolean;
  company_paid_for_order?: boolean;
  driver_paid_for_client?: boolean;
  driver_remit_status?: string;
  client_fee_rule?: "ADD_ON" | "DEDUCT" | "INCLUDED";
  client_settlement_status?: string;
  third_party_settlement_status?: string;
  address: string;
  notes?: string;
  created_at: string;
  clients?: { name: string };
  drivers?: { name: string };
  third_parties?: { name: string };
  customers?: { phone: string; name?: string };
  customer_id?: string;
}

type FeePayer = 'customer' | 'client' | 'split';
type statusTypes = "New" | "Assigned" | "PickedUp" | "Delivered" | "Returned" | "Cancelled" | "DriverCollected" | "CustomerCollected" | "PaidDueByDriver";

const deliveryStatuses = ['Delivered', 'DriverCollected', 'CustomerCollected', 'PaidDueByDriver'];

interface EditOrderDialogProps {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Helper function to derive fee_payer from client_fee_rule
const deriveFeePayer = (clientFeeRule?: string): FeePayer => {
  if (clientFeeRule === 'DEDUCT') return 'client';
  if (clientFeeRule === 'INCLUDED') return 'split';
  return 'customer';
};

// Helper function to parse split amounts from notes
const parseSplitAmounts = (notes?: string): { usd: string; lbp: string } => {
  if (!notes) return { usd: '', lbp: '' };
  const match = notes.match(/Fee split: Client \$(\d+(?:\.\d+)?) \/ LL(\d+)/);
  if (match) {
    return { usd: match[1], lbp: match[2] };
  }
  return { usd: '', lbp: '' };
};

export default function EditOrderDialog({ order, open, onOpenChange }: EditOrderDialogProps) {
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const splitAmounts = parseSplitAmounts(order.notes);

  const [formData, setFormData] = useState({
    voucher_no: order.voucher_no || "",
    address: order.address,
    order_amount_usd: order.order_amount_usd.toString(),
    delivery_fee_usd: order.delivery_fee_usd.toString(),
    order_amount_lbp: order.order_amount_lbp.toString(),
    delivery_fee_lbp: order.delivery_fee_lbp.toString(),
    amount_due_to_client_usd: order.amount_due_to_client_usd?.toString() || "0",
    third_party_fee_usd: (order as any).third_party_fee_usd?.toString() || "0",
    notes: order.notes || "",
    status: order.status as statusTypes,
    driver_id: order.driver_id || "",
    prepaid_by_runners: order.prepaid_by_runners || false,
    prepaid_by_company: order.prepaid_by_company || false,
    // Customer fields for ecom orders
    customer_phone: "",
    customer_name: "",
    // Fee payer fields for instant orders
    fee_payer: deriveFeePayer(order.client_fee_rule) as FeePayer,
    client_fee_share_usd: splitAmounts.usd,
    client_fee_share_lbp: splitAmounts.lbp,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: customer } = useQuery({
    queryKey: ["customer", order.customer_id],
    queryFn: async () => {
      if (!order.customer_id) return null;
      const { data, error } = await supabase.from("customers").select("*").eq("id", order.customer_id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!order.customer_id,
  });

  // Update form data when customer data is loaded
  useEffect(() => {
    if (customer) {
      setFormData(prev => ({
        ...prev,
        customer_phone: customer.phone || "",
        customer_name: customer.name || "",
        address: prev.address || customer.address || "",
      }));
    }
  }, [customer]);

  const updateOrderMutation = useMutation({
    mutationFn: async () => {
      const previousStatus = order.status;

      // Validate: Cannot mark as Delivered without a driver
      if (
        deliveryStatuses.includes(formData.status) && !formData.driver_id) {
        throw new Error('Cannot mark order as Delivered without assigning a driver');
      }

      // For ecom orders, update customer info if we have a customer_id
      if (order.order_type === 'ecom' && order.customer_id && formData.customer_phone) {
        const { error: customerError } = await supabase
          .from("customers")
          .update({
            phone: formData.customer_phone,
            name: formData.customer_name || null,
            address: formData.address || null,
          })
          .eq("id", order.customer_id);

        if (customerError) {
          console.error('Error updating customer:', customerError);
          throw new Error('Failed to update customer information');
        }
      }

      // Prepare update data
      const orderAmountUsd = parseFloat(formData.order_amount_usd) || 0;
      const deliveryFeeUsd = parseFloat(formData.delivery_fee_usd) || 0;
      const thirdPartyFeeUsd = parseFloat(formData.third_party_fee_usd) || 0;
      const clientNetUsd = orderAmountUsd - deliveryFeeUsd;

      const updateData: any = {
        voucher_no: formData.voucher_no || null,
        address: formData.address,
        order_amount_usd: orderAmountUsd,
        delivery_fee_usd: deliveryFeeUsd,
        amount_due_to_client_usd: parseFloat(formData.amount_due_to_client_usd) || 0,
        third_party_fee_usd: thirdPartyFeeUsd,
        client_net_usd: clientNetUsd,
        notes: formData.notes || null,
        status: formData.status,
        driver_id: formData.driver_id || null,
        prepaid_by_runners: formData.prepaid_by_runners,
        prepaid_by_company: formData.prepaid_by_company,
      };

      // Handle fee payer for instant orders
      if (order.order_type === 'instant') {
        let clientFeeRule: "ADD_ON" | "DEDUCT" | "INCLUDED" = "ADD_ON";
        let notes = formData.notes || "";

        // Remove old fee payer info from notes
        notes = notes.replace(/\s*\|\s*Fee: Client pays/g, '').replace(/\s*\|\s*Fee split: Client \$[\d.]+ \/ LL\d+/g, '').trim();

        if (formData.fee_payer === 'client') {
          clientFeeRule = "DEDUCT";
          notes = notes ? `${notes} | Fee: Client pays` : "Fee: Client pays";
        } else if (formData.fee_payer === 'split') {
          clientFeeRule = "INCLUDED";
          const clientUsd = parseFloat(formData.client_fee_share_usd) || 0;
          const clientLbp = parseFloat(formData.client_fee_share_lbp) || 0;
          const splitInfo = `Fee split: Client $${clientUsd} / LL${clientLbp}`;
          notes = notes ? `${notes} | ${splitInfo}` : splitInfo;
        }

        updateData.client_fee_rule = clientFeeRule;
        updateData.notes = notes || null;
      }

      // Set delivered_at timestamp when status changes to Delivered
      if (!deliveryStatuses.includes(previousStatus) && deliveryStatuses.includes(formData.status)) {
        updateData.delivered_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("orders")
        .update(updateData)
        .eq("id", order.id);

      if (error) throw error;

      // If status changed to Delivered, process the accounting
      if (!deliveryStatuses.includes(previousStatus) && deliveryStatuses.includes(formData.status)) {

        console.log('Order marked as delivered, processing accounting...');

        const { error: functionError } = await supabase.functions.invoke('process-order-delivery', {
          body: { orderId: order.id }
        });

        if (functionError) {
          console.error('Error processing delivery:', functionError);
          throw new Error('Order updated but accounting failed: ' + functionError.message);
        }

        if (!order?.company_paid_for_order && !order.prepaid_by_runners) {
          const { error: walletError } = await (supabase.rpc as any)('update_driver_wallet_atomic', {
            p_driver_id: updateData.driver_id,
            p_amount_usd: order?.driver_paid_for_client ? (orderAmountUsd * -1) : orderAmountUsd + deliveryFeeUsd,
            p_amount_lbp: 0,
          });

          if (walletError) {
            console.error('Error Adding to Driver Wallet:', walletError);
            throw new Error('Order updated but accounting failed: ' + walletError.message);
          }
        }

      }

      console.log(formData.status)
      console.log(previousStatus)
      console.log(previousStatus !== formData.status)
      console.log({
        order_id: order.id,
        type: formData.status === 'Assigned'
          ? 'ASSIGNED'
          : formData.status === 'PickedUp'
            ? 'PICKED_UP'
            : formData.status === 'DriverCollected'
              ? 'DELIVERED'
              : 'ORDER_CREATED', // fallback if needed
        title: `Status changed to ${formData.status}`,
        description: `Order moved from ${previousStatus} to ${formData.status}`,
      })
      if (previousStatus !== formData.status) {
        await supabase.from('order_timeline_events').insert({
          order_id: order.id,
          type: formData.status === 'Assigned'
            ? 'ASSIGNED'
            : formData.status === 'PickedUp'
              ? 'PICKED_UP'
              : formData.status === 'DriverCollected'
                ? 'DELIVERED'
                : 'ORDER_CREATED', // fallback if needed
          title: `Status changed to ${formData.status}`,
          description: `Order moved from ${previousStatus} to ${formData.status}`,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["instant-orders"] });
      queryClient.invalidateQueries({ queryKey: ["ecom-orders"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast({ title: "Order updated successfully" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async () => {
      // Check if order was delivered and needs accounting reversal
      if (order.driver_remit_status && order.status === 'Delivered') {
        console.log('Reversing accounting for delivered order:', order.order_id);

        // 1. Delete driver transaction
        if (order.driver_id) {
          const { error: driverTxError } = await supabase
            .from('driver_transactions')
            .delete()
            .eq('order_ref', order.order_id);

          if (driverTxError) {
            console.error('Error deleting driver transaction:', driverTxError);
            throw new Error('Failed to reverse driver transaction');
          }

          // 2. Reverse driver wallet balance
          const { data: driver, error: driverFetchError } = await supabase
            .from('drivers')
            .select('wallet_usd, wallet_lbp')
            .eq('id', order.driver_id)
            .single();

          if (driverFetchError) throw driverFetchError;

          if (driver) {
            const { error: walletError } = await supabase
              .from('drivers')
              .update({
                wallet_usd: Number(driver.wallet_usd) - Number(order.delivery_fee_usd),
                wallet_lbp: Number(driver.wallet_lbp) - Number(order.delivery_fee_lbp),
              })
              .eq('id', order.driver_id);

            if (walletError) {
              console.error('Error reversing driver wallet:', walletError);
              throw new Error('Failed to reverse driver wallet');
            }
          }
        }

        // 3. Delete client transaction
        if (order.client_id) {
          const { error: clientTxError } = await supabase
            .from('client_transactions')
            .delete()
            .eq('order_ref', order.order_id);

          if (clientTxError) {
            console.error('Error deleting client transaction:', clientTxError);
            throw new Error('Failed to reverse client transaction');
          }
        }

        // 4. Delete accounting entry
        const { error: accountingError } = await supabase
          .from('accounting_entries')
          .delete()
          .eq('order_ref', order.order_id);

        if (accountingError) {
          console.error('Error deleting accounting entry:', accountingError);
          throw new Error('Failed to reverse accounting entry');
        }

        console.log('Successfully reversed all accounting for order:', order.order_id);
      }

      // 5. Finally delete the order
      const { error } = await supabase.from("orders").delete().eq("id", order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["instant-orders"] });
      queryClient.invalidateQueries({ queryKey: ["ecom-orders"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      toast({ title: "Order deleted successfully" });
      setDeleteDialogOpen(false);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Edit Order: {order.order_type === 'ecom' ? order.voucher_no || order.order_id : order.order_id}</span>
              <Badge variant={order.order_type === "ecom" ? "default" : "secondary"}>{order.order_type.toUpperCase()}</Badge>
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="details" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="status">Status & Driver</TabsTrigger>
              <TabsTrigger value="payment">Payment</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-4">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Client</Label>
                    <Input value={order.clients?.name || ""} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>Order ID</Label>
                    <Input value={order.order_id} disabled />
                  </div>
                </div>

                {order.order_type === "ecom" && (
                  <>
                    <div className="space-y-2">
                      <Label>Voucher Number</Label>
                      <Input value={formData.voucher_no} onChange={(e) => setFormData({ ...formData, voucher_no: e.target.value })} />
                    </div>

                    <div className="p-4 border rounded-lg space-y-4">
                      <h4 className="font-semibold text-sm">Customer Information</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Phone</Label>
                          <Input
                            value={formData.customer_phone}
                            onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                            placeholder="Customer phone..."
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Name</Label>
                          <Input
                            value={formData.customer_name}
                            onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                            placeholder="Customer name..."
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <Label>Delivery Address</Label>
                  <Textarea value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} rows={2} />
                </div>

                {order.order_type === "ecom" ? (
                  <>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Total with Delivery (USD)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={(parseFloat(formData.order_amount_usd || "0") + parseFloat(formData.delivery_fee_usd || "0")).toFixed(2)}
                          onChange={(e) => {
                            const total = parseFloat(e.target.value) || 0;
                            const deliveryFee = parseFloat(formData.delivery_fee_usd) || 0;
                            const orderAmount = total - deliveryFee;
                            setFormData({
                              ...formData,
                              order_amount_usd: orderAmount.toString(),
                              amount_due_to_client_usd: orderAmount.toString()
                            });
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Delivery Fee (USD)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.delivery_fee_usd}
                          onChange={(e) => {
                            const deliveryFee = parseFloat(e.target.value) || 0;
                            const total = parseFloat(formData.order_amount_usd || "0") + parseFloat(formData.delivery_fee_usd || "0");
                            const orderAmount = total - deliveryFee;
                            setFormData({
                              ...formData,
                              delivery_fee_usd: e.target.value,
                              order_amount_usd: orderAmount.toString(),
                              amount_due_to_client_usd: orderAmount.toString()
                            });
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Due to Client (USD)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.amount_due_to_client_usd}
                          readOnly
                          className="bg-muted"
                          title="Auto-calculated: Total - Delivery Fee"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Order Amount (USD)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.order_amount_usd}
                        onChange={(e) => setFormData({ ...formData, order_amount_usd: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Delivery Fee (USD)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.delivery_fee_usd}
                        onChange={(e) => setFormData({ ...formData, delivery_fee_usd: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="status" className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Order Status</Label>
                  <Select value={formData.status} onValueChange={(value: statusTypes) => setFormData({ ...formData, status: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="New">New</SelectItem>
                      <SelectItem value="Assigned">Assigned</SelectItem>
                      <SelectItem value="PickedUp">Picked Up</SelectItem>
                      {/* <SelectItem value="Delivered">Delivered</SelectItem> */}
                      <SelectItem value="DriverCollected">Delivered - Driver Collected</SelectItem>
                      {/* <SelectItem value="CustomerCollected">Delivered - Customer Collected</SelectItem> */}
                      {/* <SelectItem value="PaidDueByDriver">Delivered - Paid Due By Driver</SelectItem> */}
                      <SelectItem value="Returned">Returned</SelectItem>
                      <SelectItem value="Cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Assign Driver</Label>
                  <Select
                    value={formData.driver_id || "unassigned"}
                    onValueChange={(value) => setFormData({ ...formData, driver_id: value === "unassigned" ? null : value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select driver..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">No Driver</SelectItem>
                      {drivers.map((driver) => (
                        <SelectItem key={driver.id} value={driver.id}>
                          {driver.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold text-sm mb-2">Timeline</h4>
                  <div className="space-y-1 text-sm">
                    <div>
                      <span className="text-muted-foreground">Created:</span> {new Date(order.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="payment" className="space-y-4">
              <div className="space-y-4">
                {order.order_type === "ecom" && (
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="prepaid"
                      checked={formData.prepaid_by_company}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        prepaid_by_company: checked as boolean,
                        prepaid_by_runners: checked as boolean
                      })}
                    />
                    <Label htmlFor="prepaid">Cash-Based (Prepaid to Client)</Label>
                  </div>
                )}

                {order.order_type === "instant" && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Fee Payer</Label>
                      <Select
                        value={formData.fee_payer}
                        onValueChange={(value: FeePayer) => {
                          setFormData({
                            ...formData,
                            fee_payer: value,
                            client_fee_share_usd: value !== 'split' ? '' : formData.client_fee_share_usd,
                            client_fee_share_lbp: value !== 'split' ? '' : formData.client_fee_share_lbp,
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="customer">Customer Pays</SelectItem>
                          <SelectItem value="client">Client Pays</SelectItem>
                          <SelectItem value="split">Split</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {formData.fee_payer === 'split' && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Client's Share (USD)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.client_fee_share_usd}
                            onChange={(e) => setFormData({ ...formData, client_fee_share_usd: e.target.value })}
                            placeholder="0.00"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Client's Share (LBP)</Label>
                          <Input
                            type="number"
                            step="1"
                            value={formData.client_fee_share_lbp}
                            onChange={(e) => setFormData({ ...formData, client_fee_share_lbp: e.target.value })}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="p-4 border rounded-lg space-y-2">
                  <h4 className="font-semibold text-sm">Payment Summary</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Order Amount:</span>
                      <span className="font-medium">${parseFloat(formData.order_amount_usd).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Delivery Fee:</span>
                      <span className="font-medium">${parseFloat(formData.delivery_fee_usd).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t pt-1 mt-1">
                      <span className="text-muted-foreground">Total:</span>
                      <span className="font-semibold">${(parseFloat(formData.order_amount_usd) + parseFloat(formData.delivery_fee_usd)).toFixed(2)}</span>
                    </div>
                    {order.order_type === "ecom" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Due to Client:</span>
                        <span className="font-medium">${parseFloat(formData.amount_due_to_client_usd).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-between pt-4">
            <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
              Delete Order
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => updateOrderMutation.mutate()} disabled={updateOrderMutation.isPending}>
                {updateOrderMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order {order.order_type === 'ecom' ? order.voucher_no || order.order_id : order.order_id}?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. This will permanently delete the order and all associated data.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteOrderMutation.mutate()} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
