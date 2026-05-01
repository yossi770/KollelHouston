import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import ExcelJS from "npm:exceljs@4.4.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { startDate, endDate } = await req.json()

    // 1. Validate input
    if (!startDate || !endDate) {
      throw new Error('startDate and endDate are required')
    }

    const start = new Date(startDate)
    const end = new Date(endDate)
    const diffTime = Math.abs(end - start)
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays > 186) { // ~6 months
      throw new Error('Date range must be 6 months or less')
    }

    // 2. Initialize Supabase Client with Service Role Key for admin access
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // 3. Verify Admin Status
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.is_admin) {
      throw new Error('Forbidden: Admin access required')
    }

    // 4. Fetch Sessions
    const { data: sessions, error: sessionsError } = await supabaseClient
      .from('sessions')
      .select(`
        *,
        profiles:user_id (name)
      `)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false })

    if (sessionsError) throw sessionsError

    // 5. Generate Excel
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Sessions Detail')

    sheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'User', key: 'user_name', width: 20 },
      { header: 'Start Time', key: 'start_time', width: 15 },
      { header: 'End Time', key: 'end_time', width: 15 },
      { header: 'Duration (Mins)', key: 'duration_minutes', width: 15 },
    ]

    sessions.forEach(s => {
      sheet.addRow({
        date: s.date,
        user_name: s.profiles?.name || 'Unknown',
        start_time: s.start_time,
        end_time: s.end_time || 'Active',
        duration_minutes: s.duration_minutes || 0,
      })
    })

    // Formatting
    sheet.getRow(1).font = { bold: true }
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    }

    const buffer = await workbook.xlsx.writeBuffer()

    return new Response(buffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Kollel_Report_${startDate}_${endDate}.xlsx"`,
      },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
