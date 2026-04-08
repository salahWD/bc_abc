import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

type NewOrderRow = {
  id: string;
  voucher_no: string;
  client_id: string;
  customer_phone: string;
  customer_name: string;
  customer_address: string;
  total_with_delivery_usd: string;
  delivery_fee_usd: string;
  amount_due_to_client_usd: string;
  prepaid_by_company: boolean;
  fulfillment: "InHouse" | "ThirdParty";
  third_party_id: string;
  third_party_fee_usd: string;
};

type Customer = {
  id: string;
  phone: string;
  name: string | null;
  address: string | null;
};

// Separate component for each row with proper refs
function EcomOrderRow({
  row,
  clients,
  customers,
  thirdParties,
  updateRow,
  createOrderMutation,
  setNewRows,
}: {
  row: NewOrderRow;
  clients: any[];
  customers: Customer[];
  thirdParties: any[];
  updateRow: (id: string, field: keyof NewOrderRow, value: any) => void;
  createOrderMutation: any;
  setNewRows: React.Dispatch<React.SetStateAction<NewOrderRow[]>>;
}) {
  const clientRef = useRef<HTMLButtonElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const totalRef = useRef<HTMLInputElement>(null);
  const feeRef = useRef<HTMLInputElement>(null);

  const [clientOpen, setClientOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");

  const filteredClients = clients.filter((c) =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const selectedClient = clients.find((c) => c.id === row.client_id);

  const handleClientSelect = useCallback((id: string) => {
    updateRow(row.id, "client_id", id);
    setClientSearch("");
    setClientOpen(false);
    setTimeout(() => phoneRef.current?.focus(), 0);
  }, [row.id, updateRow]);

  const handlePhoneBlur = useCallback(() => {
    const matchingCustomer = customers.find((c) => c.phone === row.customer_phone);
    if (matchingCustomer) {
      setNewRows((prevRows) => prevRows.map((r) =>
        r.id === row.id
          ? {
            ...r,
            customer_name: matchingCustomer.name || r.customer_name,
            customer_address: matchingCustomer.address || r.customer_address
          }
          : r
      ));
    }
  }, [row.id, row.customer_phone, customers, setNewRows]);

  return (
    <TableRow className="bg-accent/20">
      {/* Voucher */}
      <TableCell>
        <Input
          value={row.voucher_no}
          onChange={(e) => updateRow(row.id, "voucher_no", e.target.value)}
          className="h-8 text-xs"
          placeholder="#"
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              clientRef.current?.focus();
            }
          }}
        />
      </TableCell>

      {/* Client */}
      <TableCell>
        <Popover open={clientOpen} onOpenChange={setClientOpen}>
          <PopoverTrigger asChild>
            <Button
              ref={clientRef}
              variant="outline"
              className="w-full justify-between h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || (e.key.length === 1 && !e.ctrlKey && !e.metaKey)) {
                  e.preventDefault();
                  setClientOpen(true);
                }
              }}
            >
              {selectedClient?.name || "Client"}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[200px] p-0 bg-popover z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search..."
                value={clientSearch}
                onValueChange={setClientSearch}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Tab' && filteredClients.length > 0) {
                    e.preventDefault();
                    handleClientSelect(filteredClients[0].id);
                  }
                }}
              />
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup>
                  {filteredClients.map((client) => (
                    <CommandItem key={client.id} onSelect={() => handleClientSelect(client.id)}>
                      <Check className={cn("mr-2 h-4 w-4", row.client_id === client.id ? "opacity-100" : "opacity-0")} />
                      {client.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </TableCell>

      {/* Customer Phone */}
      <TableCell>
        <Input
          ref={phoneRef}
          value={row.customer_phone}
          onChange={(e) => updateRow(row.id, "customer_phone", e.target.value)}
          onBlur={handlePhoneBlur}
          className="h-8 text-xs"
          placeholder="Phone..."
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              handlePhoneBlur();
              nameRef.current?.focus();
            }
          }}
        />
      </TableCell>

      {/* Customer Name */}
      <TableCell>
        <Input
          ref={nameRef}
          value={row.customer_name}
          onChange={(e) => updateRow(row.id, "customer_name", e.target.value)}
          className="h-8 text-xs"
        />
      </TableCell>

      {/* Address */}
      <TableCell>
        <Input
          ref={addressRef}
          value={row.customer_address}
          onChange={(e) => updateRow(row.id, "customer_address", e.target.value)}
          className="h-8 text-xs"
        />
      </TableCell>

      {/* Total USD */}
      <TableCell>
        <Input
          ref={totalRef}
          type="number"
          step="0.01"
          value={row.total_with_delivery_usd}
          onChange={(e) => updateRow(row.id, "total_with_delivery_usd", e.target.value)}
          className="h-8 text-xs"
        />
      </TableCell>

      {/* Fee USD */}
      <TableCell>
        <Input
          ref={feeRef}
          type="number"
          step="0.01"
          value={row.delivery_fee_usd}
          onChange={(e) => updateRow(row.id, "delivery_fee_usd", e.target.value)}
          className="h-8 text-xs"
        />
      </TableCell>

      {/* Due USD (readonly) */}
      <TableCell>
        <Input
          type="number"
          step="0.01"
          value={row.amount_due_to_client_usd}
          onChange={(e) => updateRow(row.id, "amount_due_to_client_usd", e.target.value)}
          className="h-8 text-xs"
          readOnly
          title="Auto-calculated: Total - Delivery Fee"
        />
      </TableCell>

      {/* Fulfillment Type */}
      <TableCell>
        <select
          value={row.fulfillment}
          onChange={(e) => updateRow(row.id, "fulfillment", e.target.value as "InHouse" | "ThirdParty")}
          className="h-8 text-xs w-full rounded border border-input bg-background px-2"
        >
          <option value="InHouse">In-House</option>
          <option value="ThirdParty">3rd Party</option>
        </select>
      </TableCell>

      {/* Third Party (only if ThirdParty fulfillment) */}
      <TableCell>
        {row.fulfillment === "ThirdParty" ? (
          <select
            value={row.third_party_id}
            onChange={(e) => updateRow(row.id, "third_party_id", e.target.value)}
            className="h-8 text-xs w-full rounded border border-input bg-background px-2"
          >
            <option value="">Select...</option>
            {thirdParties.map((tp) => (
              <option key={tp.id} value={tp.id}>{tp.name}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </TableCell>

      {/* 3P Fee (only if ThirdParty fulfillment) */}
      <TableCell>
        {row.fulfillment === "ThirdParty" ? (
          <Input
            type="number"
            step="0.01"
            value={row.third_party_fee_usd}
            onChange={(e) => updateRow(row.id, "third_party_fee_usd", e.target.value)}
            className="h-8 text-xs"
            placeholder="0.00"
          />
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </TableCell>

      {/* Prepaid Checkbox */}
      <TableCell>
        <div className="flex justify-center">
          <Checkbox
            checked={row.prepaid_by_company}
            onCheckedChange={(checked) => updateRow(row.id, "prepaid_by_company", checked === true)}
            title="Cash-based order (will require prepayment)"
          />
        </div>
      </TableCell>

      {/* Save Button */}
      <TableCell>
        <Button
          size="sm"
          onClick={() => createOrderMutation.mutate(row)}
          disabled={!row.client_id || !row.customer_phone || (row.fulfillment === "ThirdParty" && !row.third_party_id) || createOrderMutation.isPending}
          className="h-8 text-xs"
          title={!row.client_id ? 'Please select a client' : !row.customer_phone ? 'Please enter customer phone' : (row.fulfillment === "ThirdParty" && !row.third_party_id) ? 'Please select a third party' : 'Save order'}
        >
          {createOrderMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function EcomOrderForm() {
  const queryClient = useQueryClient();
  const [newRows, setNewRows] = useState<NewOrderRow[]>([
    {
      id: `new-${Date.now()}`,
      voucher_no: "",
      client_id: "",
      customer_phone: "",
      customer_name: "",
      customer_address: "",
      total_with_delivery_usd: "",
      delivery_fee_usd: "",
      amount_due_to_client_usd: "",
      prepaid_by_company: false,
      fulfillment: "InHouse",
      third_party_id: "",
      third_party_fee_usd: "",
    },
  ]);

  const { data: thirdParties = [] } = useQuery({
    queryKey: ["third-parties"],
    queryFn: async () => {
      const { data, error } = await supabase.from("third_parties").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").order("phone");
      if (error) throw error;
      return data;
    },
  });

  const addNewRow = () => {
    setNewRows([
      ...newRows,
      {
        id: `new-${Date.now()}`,
        voucher_no: "",
        client_id: "",
        customer_phone: "",
        customer_name: "",
        customer_address: "",
        total_with_delivery_usd: "",
        delivery_fee_usd: "",
        amount_due_to_client_usd: "",
        prepaid_by_company: false,
        fulfillment: "InHouse",
        third_party_id: "",
        third_party_fee_usd: "",
      },
    ]);
  };

  const updateRow = (id: string, field: keyof NewOrderRow, value: any) => {
    setNewRows((prevRows) => prevRows.map((row) => {
      if (row.id !== id) return row;

      const updatedRow = { ...row, [field]: value };

      // Auto-calculate Due USD when total or delivery fee changes
      if (field === "total_with_delivery_usd" || field === "delivery_fee_usd") {
        const total = parseFloat(field === "total_with_delivery_usd" ? value : row.total_with_delivery_usd) || 0;
        const deliveryFee = parseFloat(field === "delivery_fee_usd" ? value : row.delivery_fee_usd) || 0;
        updatedRow.amount_due_to_client_usd = (total - deliveryFee).toString();
      }

      return updatedRow;
    }));
  };

  const createOrderMutation = useMutation({
    mutationFn: async (rowData: NewOrderRow) => {
      let customerId = null;
      if (rowData.customer_phone) {
        const { data: existingCustomer } = await supabase.from("customers").select("id").eq("phone", rowData.customer_phone).maybeSingle();

        if (existingCustomer) {
          customerId = existingCustomer.id;
          await supabase
            .from("customers")
            .update({
              name: rowData.customer_name || null,
              address: rowData.customer_address || null,
            })
            .eq("id", customerId);
        } else {
          const { data: newCustomer, error } = await supabase
            .from("customers")
            .insert({
              phone: rowData.customer_phone,
              name: rowData.customer_name || null,
              address: rowData.customer_address || null,
            })
            .select()
            .single();

          if (error) throw error;
          customerId = newCustomer.id;
        }
      }

      const { data: client } = await supabase.from("clients").select("*, client_rules(*)").eq("id", rowData.client_id).single();
      if (!client) throw new Error("Client not found");

      // For ecom orders, use voucher_no as the order_id reference
      const order_id = rowData.voucher_no;

      const totalWithDelivery = parseFloat(rowData.total_with_delivery_usd) || 0;
      const deliveryFee = parseFloat(rowData.delivery_fee_usd) || 0;
      const orderAmount = totalWithDelivery - deliveryFee;
      const amountDue = parseFloat(rowData.amount_due_to_client_usd) || 0;

      const thirdPartyFee = parseFloat(rowData.third_party_fee_usd) || 0;
      const clientNetUsd = rowData.fulfillment === "ThirdParty"
        ? orderAmount - thirdPartyFee
        : amountDue;

      const { error } = await supabase.from("orders").insert({
        order_id,
        order_type: "ecom",
        voucher_no: rowData.voucher_no || null,
        client_id: rowData.client_id,
        customer_id: customerId,
        client_type: client.type,
        fulfillment: rowData.fulfillment,
        third_party_id: rowData.fulfillment === "ThirdParty" ? rowData.third_party_id || null : null,
        third_party_fee_usd: rowData.fulfillment === "ThirdParty" ? thirdPartyFee : 0,
        order_amount_usd: orderAmount,
        delivery_fee_usd: deliveryFee,
        amount_due_to_client_usd: amountDue,
        client_net_usd: clientNetUsd,
        client_fee_rule: /* client.client_rules?.[0]?.fee_rule || */ "ADD_ON",
        prepaid_by_runners: rowData.prepaid_by_company,
        prepaid_by_company: false,
        prepay_amount_usd: rowData.prepaid_by_company ? orderAmount : 0,
        status: "New",
        address: rowData.customer_address || "",
        client_settlement_status: "Unpaid",
        third_party_settlement_status: rowData.fulfillment === "ThirdParty" ? "Pending" : null,
      });

      if (error) throw error;

      if (rowData.prepaid_by_company) {

        // Debit cashbox atomically when company pays for the order
        const today = new Date().toISOString().split('T')[0];
        const { error: cashboxError } = await (supabase.rpc as any)('update_cashbox_atomic', {
          p_date: today,
          p_cash_in_usd: 0,
          p_cash_in_lbp: 0,
          p_cash_out_usd: orderAmount,
          p_cash_out_lbp: 0,
        });

        if (cashboxError) {
          throw new Error('Failed to update cashbox: ' + cashboxError.message);
        }

        // await supabase.from('client_transactions').insert({
        //   client_id: rowData.client_id,
        //   type: 'Debit',
        //   amount_usd: orderAmount,
        //   amount_lbp: 0,
        //   note: `Payment from client - order ${rowData.voucher_no} - (paid by company)`
        // });

      }

      return rowData.id;
    },
    onSuccess: (rowId) => {
      console.log('Order created successfully', { rowId });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["ecom-orders"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("E-commerce order created successfully!");
      // Remove saved row
      setNewRows(prevRows => {
        const remaining = prevRows.filter(r => r.id !== rowId);
        // Keep at least one empty row
        if (remaining.length === 0) {
          return [{
            id: `new-${Date.now()}`,
            voucher_no: "",
            client_id: "",
            customer_phone: "",
            customer_name: "",
            customer_address: "",
            total_with_delivery_usd: "",
            delivery_fee_usd: "",
            amount_due_to_client_usd: "",
            prepaid_by_company: false,
            fulfillment: "InHouse",
            third_party_id: "",
            third_party_fee_usd: "",
          }];
        }
        return remaining;
      });
    },
    onError: (error: Error) => {
      console.error('Error creating order:', error);
      toast.error(`Failed to create order: ${error.message}`);
    },
  });

  const [isBulkSaving, setIsBulkSaving] = useState(false);

  const saveAllOrders = async () => {
    const validRows = newRows.filter(row => row.client_id && row.customer_phone);
    if (validRows.length === 0) {
      toast.error("No valid orders to save. Each order needs a client and customer phone.");
      return;
    }

    setIsBulkSaving(true);
    let successCount = 0;
    let errorCount = 0;

    for (const row of validRows) {
      try {
        await createOrderMutation.mutateAsync(row);
        successCount++;
      } catch (error) {
        errorCount++;
      }
    }

    setIsBulkSaving(false);

    if (successCount > 0 && errorCount === 0) {
      toast.success(`${successCount} order(s) saved successfully!`);
    } else if (successCount > 0 && errorCount > 0) {
      toast.warning(`${successCount} saved, ${errorCount} failed`);
    }
  };

  const validRowCount = newRows.filter(row => row.client_id && row.customer_phone).length;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Quick E-commerce Entry</h3>
        <div className="flex gap-2">
          <Button onClick={addNewRow} size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            Add Row
          </Button>
          <Button
            onClick={saveAllOrders}
            size="sm"
            disabled={validRowCount === 0 || isBulkSaving}
          >
            {isBulkSaving ? 'Saving...' : `Save All (${validRowCount})`}
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Voucher</TableHead>
              <TableHead className="w-[130px]">Client</TableHead>
              <TableHead className="w-[100px]">Phone</TableHead>
              <TableHead className="w-[100px]">Name</TableHead>
              <TableHead className="w-[120px]">Address</TableHead>
              <TableHead className="w-[80px]">Total</TableHead>
              <TableHead className="w-[70px]">Del Fee</TableHead>
              <TableHead className="w-[80px]">Due</TableHead>
              <TableHead className="w-[90px]">Fulfillment</TableHead>
              <TableHead className="w-[100px]">3rd Party</TableHead>
              <TableHead className="w-[70px]">3P Fee</TableHead>
              <TableHead className="w-[60px]">Prepaid</TableHead>
              <TableHead className="w-[70px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {newRows.map((row) => (
              <EcomOrderRow
                key={row.id}
                row={row}
                clients={clients}
                customers={customers}
                thirdParties={thirdParties}
                updateRow={updateRow}
                createOrderMutation={createOrderMutation}
                setNewRows={setNewRows}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
