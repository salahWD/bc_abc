import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { FileText, Download, CheckCircle, Search, DollarSign, ChevronDown, ChevronUp, Wallet, Clock, TrendingUp, ArrowUpRight, ArrowDownLeft, Eye, ChevronsUpDown, Check } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { ClientStatementPreview } from './ClientStatementPreview';
import { ClientStatementInlineDetail } from './ClientStatementInlineDetail';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';

export function ClientStatementsTab() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedClient, setSelectedClient] = useState('');
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedStatement, setSelectedStatement] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentAmountUsd, setPaymentAmountUsd] = useState('');
  const [paymentAmountLbp, setPaymentAmountLbp] = useState('');
  const [recordPaymentMode, setRecordPaymentMode] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewStatement, setPreviewStatement] = useState<any>(null);
  const [pendingExpanded, setPendingExpanded] = useState(true);
  const [expandedStatementId, setExpandedStatementId] = useState<string | null>(null);
  const [balanceBreakdownExpanded, setBalanceBreakdownExpanded] = useState(true);

  const { data: clients } = useQuery({
    queryKey: ['clients-for-statement'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });

  // Balance calculation: 
  // Credit = we owe the client (positive balance means we owe them)
  // Debit = client owes us (negative balance means they owe us)
  const { data: clientBalances } = useQuery({
    queryKey: ['client-balances-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_transactions').select('client_id, type, amount_usd, amount_lbp');
      if (error) throw error;

      const balances = new Map<string, { usd: number; lbp: number }>();
      data?.forEach((tx: any) => {
        const current = balances.get(tx.client_id) || { usd: 0, lbp: 0 };
        // Credit = we owe client (+), Debit = client owes us (-)
        const multiplier = tx.type === 'Credit' ? 1 : -1;
        balances.set(tx.client_id, {
          usd: current.usd + Number(tx.amount_usd || 0) * multiplier,
          lbp: current.lbp + Number(tx.amount_lbp || 0) * multiplier,
        });
      });
      return balances;
    },
  });

  const { data: orders, isLoading } = useQuery({
    queryKey: ['client-pending-orders', selectedClient, dateFrom, dateTo],
    queryFn: async () => {
      if (!selectedClient) return [];

      const { data: statementsData } = await supabase
        .from('client_statements')
        .select('order_refs')
        .eq('client_id', selectedClient);

      const usedOrderRefs = new Set<string>();
      statementsData?.forEach(stmt => {
        if (stmt.order_refs) {
          stmt.order_refs.forEach((ref: string) => usedOrderRefs.add(ref));
        }
      });

      const { data, error } = await supabase
        .from('orders')
        .select(`*, customers(phone, name, address), drivers(name)`)
        .eq('client_id', selectedClient)
        .in('status', ['Delivered', 'PaidDueByDriver', 'DriverCollected'])
        .gte('created_at', dateFrom)
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: false });

      console.log(selectedClient, dateFrom, dateTo, data)
      if (error) throw error;
      return data?.filter(order => {
        const orderRef = order.order_type === 'ecom' ? (order.voucher_no || order.order_id) : order.order_id;
        // Filter out orders already in statements
        if (usedOrderRefs.has(orderRef)) return false;

        // EXCLUDE prepaid e-commerce orders - accounting is already settled
        // When prepaid: company pays client upfront, driver collects from customer, 
        // transaction offsets the prepayment debit - no statement needed
        if (order.order_type === 'ecom' && order.prepaid_by_company) {
          return false;
        }

        // For driver-paid orders, include even if order amount is zero (delivery fee is still due)
        if (order.driver_paid_for_client) {
          const hasDeliveryFee = Number(order.delivery_fee_usd || 0) > 0 || Number(order.delivery_fee_lbp || 0) > 0;
          return hasDeliveryFee || Number(order.order_amount_usd || 0) > 0 || Number(order.order_amount_lbp || 0) > 0;
        }

        // For non-driver-paid orders, only include if there's an order amount
        const hasOrderAmount = Number(order.order_amount_usd || 0) > 0 || Number(order.order_amount_lbp || 0) > 0;
        return hasOrderAmount;
      }) || [];
    },
    enabled: !!selectedClient,
  });

  // Balance breakdown: show transactions that make up the current balance
  const { data: balanceBreakdown } = useQuery({
    queryKey: ['client-balance-breakdown', selectedClient],
    queryFn: async () => {
      if (!selectedClient) return [];

      const { data, error } = await supabase
        .from('client_transactions')
        .select('*')
        .eq('client_id', selectedClient)
        .order('ts', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedClient,
  });

  const { data: statementHistory, isLoading: loadingHistory } = useQuery({
    queryKey: ['client-statements-history', selectedClient],
    queryFn: async () => {
      const query = supabase
        .from('client_statements')
        .select(`*, clients(name)`)
        .order('issued_date', { ascending: false });

      if (selectedClient) {
        query.eq('client_id', selectedClient);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: statementOrders } = useQuery({
    queryKey: ['statement-orders', previewStatement?.id],
    queryFn: async () => {
      if (!previewStatement?.order_refs?.length) return [];

      const { data, error } = await supabase
        .from('orders')
        .select(`*, customers(phone, name, address), drivers(name)`)
        .or(previewStatement.order_refs.map((ref: string) => `order_id.eq.${ref},voucher_no.eq.${ref}`).join(','));

      if (error) throw error;
      return data || [];
    },
    enabled: !!previewStatement?.order_refs?.length,
  });

  const filteredOrders = orders?.filter(order => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      order.order_id?.toLowerCase().includes(search) ||
      order.voucher_no?.toLowerCase().includes(search) ||
      order.customers?.name?.toLowerCase().includes(search) ||
      order.customers?.phone?.toLowerCase().includes(search) ||
      order.address?.toLowerCase().includes(search)
    );
  }) || [];

  const handleSelectAll = () => {
    if (selectedOrders.length === filteredOrders.length) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(filteredOrders.map(o => o.id));
    }
  };

  const handleToggleOrder = (orderId: string) => {
    setSelectedOrders(prev =>
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  };

  const calculateTotals = () => {
    const selectedOrdersData = orders?.filter(o => selectedOrders.includes(o.id)) || [];

    return selectedOrdersData.reduce((acc, order) => {
      let dueToClientUsd = 0;
      let dueToClientLbp = 0;

      if (order.order_type === 'instant') {
        if (order.driver_paid_for_client) {
          dueToClientUsd = -1 * (Number(order.order_amount_usd || 0) + Number(order.delivery_fee_usd || 0));
          dueToClientLbp = -1 * (Number(order.order_amount_lbp || 0) + Number(order.delivery_fee_lbp || 0));
        } else {
          if (order.company_paid_for_order) {
            dueToClientUsd = -1 * (Number(order.order_amount_usd || 0) + Number(order.delivery_fee_usd || 0));
            dueToClientLbp = -1 * (Number(order.order_amount_lbp || 0) + Number(order.delivery_fee_lbp || 0));
          } else {
            dueToClientUsd = Number(order.order_amount_usd || 0);
            dueToClientLbp = Number(order.order_amount_lbp || 0);
          }
        }
      } else {
        if (order.prepaid_by_runners) {
          dueToClientUsd = -1 * (Number(order.order_amount_usd || 0) + Number(order.delivery_fee_usd || 0));
        } else {
          dueToClientUsd = Number(order.amount_due_to_client_usd || 0);
        }
        dueToClientLbp = 0;
      }

      return {
        totalOrders: acc.totalOrders + 1,
        totalOrderAmountUsd: acc.totalOrderAmountUsd + Number(order.order_amount_usd || 0),
        totalOrderAmountLbp: acc.totalOrderAmountLbp + Number(order.order_amount_lbp || 0),
        totalDeliveryFeesUsd: acc.totalDeliveryFeesUsd + Number(order.delivery_fee_usd || 0),
        totalDeliveryFeesLbp: acc.totalDeliveryFeesLbp + Number(order.delivery_fee_lbp || 0),
        totalDueToClientUsd: acc.totalDueToClientUsd + dueToClientUsd,
        totalDueToClientLbp: acc.totalDueToClientLbp + dueToClientLbp,
      };
    }, {
      totalOrders: 0,
      totalOrderAmountUsd: 0,
      totalOrderAmountLbp: 0,
      totalDeliveryFeesUsd: 0,
      totalDeliveryFeesLbp: 0,
      totalDueToClientUsd: 0,
      totalDueToClientLbp: 0,
    });
  };

  const totals = calculateTotals();
  const selectedClientData = clients?.find(c => c.id === selectedClient);
  // Determine if we owe client or they owe us based on net balance
  // Positive balance = we owe client, Negative = they owe us
  // If mixed (one positive, one negative), use the dominant currency or sum them logically

  const unpaidStatements = statementHistory?.filter(s => s.status === 'unpaid')?.length || 0;
  const totalPending = orders?.length || 0;

  // const unpaidStatementsTotal =
  //   statementHistory
  //     ?.filter(s => s.status === 'unpaid')
  //     .reduce((sum, s) => sum + Number(s.net_due_usd || 0), 0) || 0;

  const clientBalance = clientBalances?.get(selectedClient) || { usd: 0, lbp: 0 };
  const transactionBalance = clientBalances?.get(selectedClient) || { usd: 0, lbp: 0 };

  const usdLbpTransactionBalance = transactionBalance.usd + (clientBalance.lbp / 100000);
  const realBalanceUsd = usdLbpTransactionBalance /* + unpaidStatementsTotal */;

  // Determine payment direction based on current balance:
  // If we owe the client (positive balance) = we're paying them = cash out
  // If client owes us (negative balance) = they're paying us = cash in
  const isPayingClient = realBalanceUsd > 0;

  const issueStatementMutation = useMutation({
    mutationFn: async () => {
      if (selectedOrders.length === 0) throw new Error('No orders selected');

      const selectedOrdersData = orders?.filter(o => selectedOrders.includes(o.id)) || [];
      const orderRefs = selectedOrdersData.map(o => o.order_type === 'ecom' ? (o.voucher_no || o.order_id) : o.order_id);

      const { data: statementIdData, error: idError } = await supabase.rpc('generate_client_statement_id');
      if (idError) throw idError;

      const { error: insertError } = await supabase.from('client_statements').insert({
        client_id: selectedClient,
        statement_id: statementIdData,
        period_from: dateFrom,
        period_to: dateTo,
        total_orders: totals.totalOrders,
        total_delivered: totals.totalOrders,
        total_order_amount_usd: totals.totalOrderAmountUsd,
        total_order_amount_lbp: totals.totalOrderAmountLbp,
        total_delivery_fees_usd: totals.totalDeliveryFeesUsd,
        total_delivery_fees_lbp: totals.totalDeliveryFeesLbp,
        net_due_usd: totals.totalDueToClientUsd,
        net_due_lbp: totals.totalDueToClientLbp,
        order_refs: orderRefs,
        status: 'unpaid',
        created_by: user?.id,
      });

      if (insertError) throw insertError;
      // we add a credit transaction when we make a statment so that the balance of the client can change to accept payments
      // if credited => should take money
      // if debited => should pay money
      if (totals.totalDueToClientUsd > 0 || totals.totalDueToClientLbp > 0) {// come fix if statement has more then one order with differant type (some are company paid and some are not)
        const { error: insertTransactionError } = await supabase.from('client_transactions').insert({
          client_id: selectedClient,
          type: 'Credit',
          amount_usd: totals.totalDueToClientUsd,
          amount_lbp: totals.totalDueToClientLbp,
          note:
            `We owe Client the statement amount- ${statementIdData}`,
        });

        if (insertTransactionError) throw insertTransactionError;
      }
      return statementIdData;
    },
    onSuccess: (statementId) => {
      toast.success(`Statement ${statementId} issued`);
      queryClient.invalidateQueries({ queryKey: ['client-pending-orders'] });
      queryClient.invalidateQueries({ queryKey: ['client-statements-history'] });
      setSelectedOrders([]);
    },
    onError: (error) => {
      toast.error(`Failed: ${error.message}`);
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      const amountUsd = parseFloat(paymentAmountUsd) || 0;
      const amountLbp = parseFloat(paymentAmountLbp) || 0;

      if (amountUsd === 0 && amountLbp === 0) throw new Error('Enter a payment amount');

      const today = new Date().toISOString().split('T')[0];

      // Use atomic cashbox update
      const { error: cashboxError } = await (supabase.rpc as any)('update_cashbox_atomic', {
        p_date: today,
        p_cash_in_usd: isPayingClient ? 0 : amountUsd,
        p_cash_in_lbp: isPayingClient ? 0 : amountLbp,
        p_cash_out_usd: isPayingClient ? amountUsd : 0,
        p_cash_out_lbp: isPayingClient ? amountLbp : 0,
      });
      console.log("realBalanceUsd:", realBalanceUsd);
      console.log(
        "p_date: ", today,
        "p_cash_in_usd: ", isPayingClient ? 0 : amountUsd,
        "p_cash_in_lbp: ", isPayingClient ? 0 : amountLbp,
        "p_cash_out_usd: ", isPayingClient ? amountUsd : 0,
        "p_cash_out_lbp: ", isPayingClient ? amountLbp : 0,
      )

      if (cashboxError) throw cashboxError;

      // Record transaction: 
      // When we pay client (reduce our debt to them), we Debit their account
      // When client pays us (reduce their debt to us), we Credit their account
      await supabase.from('client_transactions').insert({
        client_id: selectedClient,
        type: isPayingClient ? 'Debit' : 'Credit',
        amount_usd: amountUsd,
        amount_lbp: amountLbp,
        note: selectedStatement
          ? `Payment ${isPayingClient ? 'to' : 'from'} client - Statement ${selectedStatement.statement_id} - ${paymentMethod}`
          : `Payment ${isPayingClient ? 'to' : 'from'} client - ${paymentMethod}${paymentNotes ? ` - ${paymentNotes}` : ''}`,
      });

      if (selectedStatement) {
        // Record CLIENT_PAYOUT transactions in audit log for each order
        if (selectedStatement.order_refs?.length) {
          // Get order IDs from order_refs
          const { data: orderData } = await supabase
            .from('orders')
            .select('id, order_id, voucher_no, client_net_usd')
            .or(selectedStatement.order_refs.map((ref: string) => `order_id.eq.${ref},voucher_no.eq.${ref}`).join(','));

          if (orderData?.length) {
            const transactions = orderData.map(order => ({
              order_id: order.id,
              party_type: 'CLIENT' as const,
              party_id: selectedClient,
              direction: isPayingClient ? 'OUT' as const : 'IN' as const,
              amount_usd: Number(order.client_net_usd || 0),
              tx_type: 'CLIENT_PAYOUT' as const,
              tx_date: new Date().toISOString(),
              recorded_by: user?.id,
              note: `Statement ${selectedStatement.statement_id} - ${paymentMethod}`,
            }));

            await supabase.from('order_transactions').insert(transactions);

            // Update orders client_settlement_status
            // await supabase.from('orders')
            //   .update({
            //     client_settlement_status: 'Paid',
            //     driver_remit_status: 'Collected'
            //   })
            //   .in('id', orderData.map(o => o.id));
          }
        }

        await supabase.from('client_statements').update({
          status: 'paid',
          paid_date: new Date().toISOString(),
          payment_method: paymentMethod,
          notes: paymentNotes || null,
        }).eq('id', selectedStatement.id);
      }
    },
    onSuccess: () => {
      toast.success('Payment recorded');
      queryClient.invalidateQueries({ queryKey: ['client-statements-history'] });
      queryClient.invalidateQueries({ queryKey: ['client-balances-all'] });
      queryClient.invalidateQueries({ queryKey: ['client-pending-orders'] });
      queryClient.invalidateQueries({ queryKey: ['cashbox'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['instant-orders'] });
      queryClient.invalidateQueries({ queryKey: ['ecom-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order-transactions'] });
      setPaymentDialogOpen(false);
      setSelectedStatement(null);
      setPaymentAmountUsd('');
      setPaymentAmountLbp('');
      setPaymentMethod('cash');
      setPaymentNotes('');
      setRecordPaymentMode(false);
    },
    onError: (error) => {
      toast.error(`Failed: ${error.message}`);
    },
  });

  const openPaymentDialog = (statement?: any) => {
    setSelectedStatement(statement || null);
    setRecordPaymentMode(!statement);
    if (statement) {
      setPaymentAmountUsd(Math.abs(statement.net_due_usd || 0).toString());
      setPaymentAmountLbp(Math.abs(statement.net_due_lbp || 0).toString());
    } else {
      setPaymentAmountUsd('');
      setPaymentAmountLbp('');
    }
    setPaymentDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <Card className="border-sidebar-border bg-sidebar/50">
        <CardContent className="pt-4 pb-3">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="md:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Client</Label>
              <Popover open={clientSearchOpen} onOpenChange={setClientSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={clientSearchOpen}
                    className="w-full justify-between h-9 font-normal"
                  >
                    {selectedClient
                      ? clients?.find((c) => c.id === selectedClient)?.name
                      : "Search client..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0 bg-popover" align="start">
                  <Command>
                    <CommandInput placeholder="Search client..." />
                    <CommandList>
                      <CommandEmpty>No client found.</CommandEmpty>
                      <CommandGroup>
                        {clients?.map((client) => {
                          const bal = clientBalances?.get(client.id) || { usd: 0, lbp: 0 };
                          return (
                            <CommandItem
                              key={client.id}
                              value={client.name}
                              onSelect={() => {
                                setSelectedClient(client.id);
                                setClientSearchOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedClient === client.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <span className="flex-1">{client.name}</span>
                              <span className={`text-xs font-mono ${bal.usd < 0 ? 'text-status-error' : 'text-status-success'}`}>
                                ${bal.usd.toFixed(2)}
                                {bal.lbp !== 0 && (
                                  <span className="ml-1">/ {bal.lbp.toLocaleString()} LL</span>
                                )}
                              </span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Actions</Label>
              <Button
                variant="outline"
                className="w-full h-9 text-xs"
                onClick={() => openPaymentDialog()}
                disabled={!selectedClient}
              >
                <DollarSign className="mr-1.5 h-3.5 w-3.5" />
                {isPayingClient ? 'Pay Client' : 'Receive'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {selectedClient && (
        <div className="grid grid-cols-5 gap-3">
          <Card className="border-sidebar-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Balance</span>
              </div>
              <div className={`font-bold font-mono mt-1 ${realBalanceUsd < 0 || clientBalance.lbp < 0 ? 'text-status-error' : 'text-status-success'}`}>
                <p className="text-lg">${Math.abs(realBalanceUsd).toFixed(2)}</p>
                {clientBalance.lbp !== 0 && (
                  <p className="text-sm">{Math.abs(clientBalance.lbp).toLocaleString()} LL</p>
                )}
              </div>
              <Badge variant="outline" className={`text-xs mt-1 ${isPayingClient ? 'border-status-success text-status-success' : 'border-status-error text-status-error'}`}>
                {isPayingClient ? (
                  <><ArrowUpRight className="mr-0.5 h-3 w-3" />We Owe</>
                ) : (
                  <><ArrowDownLeft className="mr-0.5 h-3 w-3" />They Owe</>
                )}
              </Badge>
            </CardContent>
          </Card>
          <Card className="border-sidebar-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Pending Orders</span>
              </div>
              <p className="text-lg font-bold font-mono mt-1">{totalPending}</p>
            </CardContent>
          </Card>
          <Card className="border-sidebar-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Unpaid Statements</span>
              </div>
              <p className={`text-lg font-bold font-mono mt-1 ${unpaidStatements > 0 ? 'text-status-warning' : ''}`}>
                {unpaidStatements}
              </p>
            </CardContent>
          </Card>
          <Card className="border-sidebar-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Selected Orders</span>
              </div>
              <p className="text-lg font-bold font-mono mt-1">{selectedOrders.length}</p>
            </CardContent>
          </Card>
          <Card className="border-sidebar-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Selected Total</span>
              </div>
              <div className="font-bold font-mono mt-1 text-status-success">
                <p className="text-lg">${totals.totalDueToClientUsd.toFixed(2)}</p>
                {totals.totalDueToClientLbp > 0 && (
                  <p className="text-sm">{totals.totalDueToClientLbp.toLocaleString()} LL</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Balance Breakdown Section - shows what makes up the current balance */}
      {selectedClient && (realBalanceUsd !== 0 || clientBalance.lbp !== 0) && (
        <Collapsible open={balanceBreakdownExpanded} onOpenChange={setBalanceBreakdownExpanded}>
          <Card className="border-sidebar-border border-dashed">
            <CollapsibleTrigger asChild>
              <CardHeader className="py-2 px-4 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    {balanceBreakdownExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                    Balance Breakdown ({balanceBreakdown?.length || 0} transactions)
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">Shows what makes up the current balance</span>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="p-0">
                {balanceBreakdown && balanceBreakdown.length > 0 ? (
                  <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow className="text-xs">
                          <TableHead className="py-2">Date</TableHead>
                          <TableHead className="py-2">Type</TableHead>
                          <TableHead className="py-2">Description</TableHead>
                          <TableHead className="py-2">Order Ref</TableHead>
                          <TableHead className="py-2 text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {balanceBreakdown.map((tx: any) => (
                          <TableRow key={tx.id} className="text-sm">
                            <TableCell className="py-1.5">
                              {format(new Date(tx.ts), 'MMM dd, yyyy')}
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Badge
                                variant="outline"
                                className={tx.type === 'Credit' ? 'text-status-success border-status-success' : 'text-status-error border-status-error'}
                              >
                                {tx.type === 'Credit' ? 'We Owe' : 'Paid'}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-1.5 text-muted-foreground max-w-[200px] truncate">
                              {tx.note || '-'}
                            </TableCell>
                            <TableCell className="py-1.5 font-mono text-xs">
                              {tx.order_ref || '-'}
                            </TableCell>
                            <TableCell className={`py-1.5 text-right font-mono ${tx.type === 'Credit' ? 'text-status-success' : 'text-status-error'}`}>
                              {tx.type === 'Credit' ? '+' : '-'}
                              {Number(tx.amount_usd || 0) > 0 && `$${Number(tx.amount_usd).toFixed(2)}`}
                              {Number(tx.amount_usd || 0) > 0 && Number(tx.amount_lbp || 0) > 0 && ' / '}
                              {Number(tx.amount_lbp || 0) > 0 && `${Number(tx.amount_lbp).toLocaleString()} LL`}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-center py-4 text-muted-foreground text-sm">No transactions found.</p>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Pending Orders Section */}
      {selectedClient && (
        <Collapsible open={pendingExpanded} onOpenChange={setPendingExpanded}>
          <Card className="border-sidebar-border">
            <CollapsibleTrigger asChild>
              <CardHeader className="py-2 px-4 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    {pendingExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    Pending Orders ({filteredOrders.length})
                  </CardTitle>
                  <div className="flex items-center gap-3">
                    {selectedOrders.length > 0 && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                        {selectedOrders.length} selected
                      </span>
                    )}
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleSelectAll(); }}>
                      {selectedOrders.length === filteredOrders.length ? 'Clear' : 'Select All'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="p-0">
                {isLoading ? (
                  <p className="text-center py-6 text-muted-foreground text-sm">Loading...</p>
                ) : filteredOrders.length > 0 ? (
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow className="text-xs">
                          <TableHead className="w-8 py-2"></TableHead>
                          <TableHead className="py-2">Date</TableHead>
                          <TableHead className="py-2">Order</TableHead>
                          <TableHead className="py-2">Type</TableHead>
                          <TableHead className="py-2 text-right">Order Amt</TableHead>
                          <TableHead className="py-2 text-center">Driver Paid</TableHead>
                          <TableHead className="py-2 text-right">Fee</TableHead>
                          <TableHead className="py-2 text-right">Due</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredOrders.map((order) => {
                          let dueToClientUsd = 0;
                          const orderAmountUsd = Number(order.order_amount_usd || 0);
                          const orderAmountLpb = Number(order.order_amount_lbp || 0);
                          const feeUsd = Number(order.delivery_fee_usd || 0);
                          const feeLpb = Number(order.delivery_fee_lbp || 0);

                          if (order.order_type === 'instant') {
                            if (order.driver_paid_for_client) {
                              dueToClientUsd = -1 * (orderAmountUsd + feeUsd);
                            } else {
                              dueToClientUsd = orderAmountUsd;
                            }
                          } else {
                            dueToClientUsd = Number(order.amount_due_to_client_usd || 0);
                          }

                          return (
                            <TableRow key={order.id} className="h-8 text-xs">
                              <TableCell className="py-1">
                                <Checkbox
                                  checked={selectedOrders.includes(order.id)}
                                  onCheckedChange={() => handleToggleOrder(order.id)}
                                />
                              </TableCell>
                              <TableCell className="py-1 text-muted-foreground">
                                {format(new Date(order.created_at), 'MMM dd')}
                              </TableCell>
                              <TableCell className="py-1 font-mono">
                                {order.order_type === 'ecom' ? (order.voucher_no || order.order_id) : order.order_id}
                              </TableCell>
                              <TableCell className="py-1">
                                <Badge variant="outline" className="text-[10px] px-1 py-0">{order.order_type}</Badge>
                              </TableCell>
                              <TableCell className="py-1 text-right font-mono">
                                ${orderAmountUsd.toFixed(2)} / {orderAmountLpb} LL
                              </TableCell>
                              <TableCell className="py-1 text-center">
                                {order.driver_paid_for_client ? (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 text-status-info">Yes</Badge>
                                ) : '-'}
                              </TableCell>
                              <TableCell className="py-1 text-right font-mono">
                                {order.driver_paid_for_client ? `$${feeUsd.toFixed(2) + " / " + feeLpb + " LL"}` : '-'}
                              </TableCell>
                              <TableCell className="py-1 text-right font-mono font-semibold">
                                ${dueToClientUsd.toFixed(2)} / {totals.totalDueToClientLbp} LL
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-center py-6 text-muted-foreground text-sm">No pending orders in this period.</p>
                )}

                {/* Action Bar */}
                {selectedOrders.length > 0 && (
                  <div className="border-t bg-muted/30 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-6 text-xs">
                      <div>
                        <span className="text-muted-foreground">Orders: </span>
                        <span className="font-semibold">{totals.totalOrders}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Order Amt: </span>
                        <span className="font-mono font-semibold">${totals.totalOrderAmountUsd.toFixed(2)} / {totals.totalOrderAmountLbp}</span>
                      </div>
                      <div className="border-l pl-6">
                        <span className="text-muted-foreground">Net Due: </span>
                        <span className="font-mono font-bold text-base">${totals.totalDueToClientUsd.toFixed(2)} / {totals.totalDueToClientLbp} LL</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={issueStatementMutation.isPending} onClick={() => setPreviewDialogOpen(true)}>
                        <Eye className="mr-1.5 h-3.5 w-3.5" />
                        {issueStatementMutation.isPending ? 'Processing...' : 'Preview & Issue'}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Statement History */}
      <Card className="border-sidebar-border">
        <CardHeader className="py-2 px-4">
          <CardTitle className="text-sm font-medium">Statement History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingHistory ? (
            <p className="text-center py-6 text-muted-foreground text-sm">Loading...</p>
          ) : statementHistory && statementHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="py-2 w-8"></TableHead>
                    <TableHead className="py-2">ID</TableHead>
                    {!selectedClient && <TableHead className="py-2">Client</TableHead>}
                    <TableHead className="py-2">Period</TableHead>
                    <TableHead className="py-2 text-right">Net Due</TableHead>
                    <TableHead className="py-2 text-center">Orders</TableHead>
                    <TableHead className="py-2 text-center">Status</TableHead>
                    <TableHead className="py-2">Issued</TableHead>
                    <TableHead className="py-2 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statementHistory.map((statement) => (
                    <>
                      <TableRow
                        key={statement.id}
                        className={cn(
                          "h-9 text-xs cursor-pointer hover:bg-muted/50",
                          expandedStatementId === statement.id && "bg-muted/50"
                        )}
                        onClick={() => setExpandedStatementId(
                          expandedStatementId === statement.id ? null : statement.id
                        )}
                      >
                        <TableCell className="py-1">
                          {expandedStatementId === statement.id ? (
                            <ChevronUp className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="py-1 font-mono">{statement.statement_id}</TableCell>
                        {!selectedClient && <TableCell className="py-1">{statement.clients?.name}</TableCell>}
                        <TableCell className="py-1 text-muted-foreground">
                          {format(new Date(statement.period_from), 'MMM dd')} - {format(new Date(statement.period_to), 'MMM dd')}
                        </TableCell>
                        <TableCell className="py-1 text-right font-mono font-semibold">
                          <div>${Number(statement.net_due_usd).toFixed(2)}</div>
                          {Number(statement.net_due_lbp || 0) !== 0 && (
                            <div className="text-muted-foreground text-[10px]">{Number(statement.net_due_lbp || 0).toLocaleString()} LL</div>
                          )}
                        </TableCell>
                        <TableCell className="py-1 text-center">{statement.order_refs?.length || 0}</TableCell>
                        <TableCell className="py-1 text-center">
                          <StatusBadge status={statement.status} type="statement" />
                        </TableCell>
                        <TableCell className="py-1 text-muted-foreground">
                          {format(new Date(statement.issued_date), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell className="py-1 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {statement.status === 'unpaid' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => { openPaymentDialog(statement) }}
                              >
                                <DollarSign className="mr-1 h-3 w-3" />
                                Pay
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedStatementId === statement.id && (
                        <TableRow key={`${statement.id}-detail`}>
                          <TableCell colSpan={selectedClient ? 9 : 10} className="p-0">
                            <ClientStatementInlineDetail statement={statement} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-center py-6 text-muted-foreground text-sm">
              {selectedClient ? 'No statements found for this client.' : 'Select a client to view history, or view all statements.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isPayingClient ? 'Pay Client' : 'Receive Payment'}
            </DialogTitle>
            <DialogDescription>
              {selectedStatement ? (
                <span className="block mt-1">
                  Statement <span className="font-mono font-medium">{selectedStatement.statement_id}</span>
                  <br />
                  Amount: <span className="font-mono font-semibold">
                    ${Math.abs(selectedStatement.net_due_usd || 0).toFixed(2)}
                    {Number(selectedStatement.net_due_lbp || 0) !== 0 && (
                      <span className="ml-2">{Math.abs(Number(selectedStatement.net_due_lbp || 0)).toLocaleString()} LL</span>
                    )}
                  </span>
                </span>
              ) : (
                <span className="block mt-1">
                  Client: <span className="font-medium">{selectedClientData?.name}</span>
                  <br />
                  Current Balance: <span className={`font-mono font-semibold ${isPayingClient ? 'text-status-success' : 'text-status-error'}`}>
                    ${Math.abs(realBalanceUsd).toFixed(2)}
                    {clientBalance.lbp !== 0 && (
                      <span className="ml-2">{Math.abs(clientBalance.lbp).toLocaleString()} LL</span>
                    )}
                  </span>
                  <span className="text-xs ml-2">({isPayingClient ? 'We owe client' : 'Client owes us'})</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm">Amount USD</Label>
                <Input
                  type="number"
                  value={paymentAmountUsd}
                  onChange={(e) => setPaymentAmountUsd(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Amount LBP</Label>
                <Input
                  type="number"
                  value={paymentAmountLbp}
                  onChange={(e) => setPaymentAmountLbp(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Notes (Optional)</Label>
              <Input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Add notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => recordPaymentMutation.mutate()} disabled={recordPaymentMutation.isPending}>
              <CheckCircle className="mr-2 h-4 w-4" />
              {recordPaymentMutation.isPending ? 'Processing...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Statement Preview Dialog */}
      <ClientStatementPreview
        open={previewDialogOpen}
        onOpenChange={(open) => {
          setPreviewDialogOpen(open);
          if (!open) setPreviewStatement(null);
        }}
        orders={previewStatement ? (statementOrders || []) : (orders?.filter(o => selectedOrders.includes(o.id)) || [])}
        clientName={previewStatement?.clients?.name || selectedClientData?.name || ''}
        dateFrom={previewStatement?.period_from || dateFrom}
        dateTo={previewStatement?.period_to || dateTo}
        issueStatementMutation={issueStatementMutation}
        totals={previewStatement ? {
          totalOrders: previewStatement.order_refs?.length || 0,
          totalOrderAmountUsd: Number(previewStatement.total_order_amount_usd || 0),
          totalOrderAmountLbp: Number(previewStatement.total_order_amount_lbp || 0),
          totalDeliveryFeesUsd: Number(previewStatement.total_delivery_fees_usd || 0),
          totalDeliveryFeesLbp: Number(previewStatement.total_delivery_fees_lbp || 0),
          totalDueToClientUsd: Number(previewStatement.net_due_usd || 0),
          totalDueToClientLbp: Number(previewStatement.net_due_lbp || 0),
        } : totals}
      />
    </div>
  );
}
