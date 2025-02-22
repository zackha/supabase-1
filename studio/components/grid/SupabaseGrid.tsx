import { useEffect, useState, useRef, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { useMonaco } from '@monaco-editor/react'
import { DataGridHandle } from '@supabase/react-data-grid'

import { useUrlState } from 'hooks'
import { Dictionary, SupabaseGridProps, SupabaseGridRef } from './types'
import { useTableRowsQuery } from 'data/table-rows/table-rows-query'
import { StoreProvider, useDispatch, useTrackedState } from './store'
import { Shortcuts } from './components/common'
import { Grid } from './components/grid'
import Header from './components/header'
import Footer from './components/footer'
import { RowContextMenu } from './components/menu'
import {
  cleanupProps,
  initTable,
  saveStorageDebounced,
  formatFilterURLParams,
  formatSortURLParams,
} from './SupabaseGrid.utils'
import { useProjectContext } from 'components/layouts/ProjectLayout/ProjectContext'

/** Supabase Grid: React component to render database table */

export const SupabaseGrid = forwardRef<SupabaseGridRef, SupabaseGridProps>((props, ref) => {
  const monaco = useMonaco()
  const _props = cleanupProps(props)
  const { theme } = _props

  useEffect(() => {
    if (monaco) {
      const darkTheme = theme && theme === 'dark' ? true : false
      monaco.editor.defineTheme('supabase', {
        base: darkTheme ? 'vs-dark' : 'vs',
        inherit: true, // can also be false to completely replace the builtin rules
        rules: [
          { token: 'string.sql', foreground: '24b47e' },
          { token: 'comment', foreground: '666666' },
          { token: 'predefined.sql', foreground: '999999' },
        ],
        colors: {
          'editor.background': darkTheme ? '#222222' : '#fbfcfd',
        },
      })
    }
  }, [monaco, theme])

  return (
    <StoreProvider>
      <DndProvider backend={HTML5Backend}>
        <SupabaseGridLayout ref={ref} {..._props} />
      </DndProvider>
    </StoreProvider>
  )
})

const SupabaseGridLayout = forwardRef<SupabaseGridRef, SupabaseGridProps>((props, ref) => {
  const { editable, storageRef, gridProps, headerActions } = props
  const dispatch = useDispatch()
  const state = useTrackedState()

  const gridRef = useRef<DataGridHandle>(null)
  const [mounted, setMounted] = useState(false)

  const [{ sort, filter }, setParams] = useUrlState({
    arrayKeys: ['sort', 'filter'],
  })
  const sorts = formatSortURLParams(sort as string[])
  const filters = formatFilterURLParams(filter as string[])

  const table = props.table

  const { project } = useProjectContext()
  const { data, isLoading, isRefetching } = useTableRowsQuery(
    {
      queryKey: [table.schema, table.name],
      projectRef: project?.ref,
      connectionString: project?.connectionString,
      table,
      sorts,
      filters,
      page: state.page,
      limit: state.rowsPerPage,
    },
    {
      keepPreviousData: true,
      onSuccess(data) {
        dispatch({
          type: 'SET_ROWS_COUNT',
          payload: data.rows.length,
        })
      },
    }
  )

  useImperativeHandle(ref, () => ({
    rowAdded(row: Dictionary<any>) {
      dispatch({
        type: 'ADD_NEW_ROW',
        payload: row,
      })
    },
    rowEdited(row: Dictionary<any>, idx: number) {
      dispatch({
        type: 'EDIT_ROW',
        payload: { row, idx },
      })
    },
  }))

  useEffect(() => {
    if (!mounted) setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted) {
      dispatch({ type: 'UPDATE_FILTERS', payload: {} })
    }
  }, [JSON.stringify(filters)])

  useEffect(() => {
    if (mounted) {
      dispatch({ type: 'UPDATE_SORTS', payload: {} })
    }
  }, [JSON.stringify(sorts)])

  useEffect(() => {
    if (state.isInitialComplete && storageRef && state.table) {
      saveStorageDebounced(state, storageRef, sort as string[], filter as string[])
    }
  }, [
    state.table,
    state.isInitialComplete,
    state.gridColumns,
    JSON.stringify(sorts),
    JSON.stringify(filters),
    storageRef,
  ])

  useEffect(() => {
    if (!state.metaService) {
      dispatch({
        type: 'INIT_CLIENT',
        payload: { onSqlQuery: props.onSqlQuery },
      })
      dispatch({
        type: 'INIT_CALLBACK',
        payload: { ...props },
      })
    }
  }, [state.metaService])

  useEffect(() => {
    if (!state.metaService) return

    const initializeData = async () => {
      const { savedState } = await initTable(
        props,
        state,
        dispatch,
        sort as string[],
        filter as string[]
      )

      if (savedState.sorts || savedState.filters) {
        setParams((prevParams) => {
          return {
            ...prevParams,
            ...(savedState.sorts && { sort: savedState.sorts }),
            ...(savedState.filters && { filter: savedState.filters }),
          }
        })
      }
    }

    const refreshView =
      typeof props.table === 'string' &&
      state?.table?.name !== props.table &&
      state?.table?.schema !== props.schema
    const refreshTable =
      typeof props.table !== 'string' && JSON.stringify(props.table) !== JSON.stringify(state.table)

    if (!state.table || refreshView || refreshTable) {
      initializeData()
    }
  }, [state.metaService, state.table, table, props.schema])

  return (
    <div className="sb-grid">
      <Header
        table={table}
        sorts={sorts}
        filters={filters}
        onAddRow={editable ? props.onAddRow : undefined}
        onAddColumn={editable ? props.onAddColumn : undefined}
        headerActions={headerActions}
      />
      <Grid
        ref={gridRef}
        {...gridProps}
        rows={data?.rows ?? []}
        updateRow={props.updateTableRow}
        onEditForeignKeyColumnValue={props.onEditForeignKeyColumnValue}
      />
      <Footer isLoading={isLoading || isRefetching} />
      <Shortcuts gridRef={gridRef} />
      {mounted &&
        createPortal(<RowContextMenu table={table} rows={data?.rows ?? []} />, document.body)}
    </div>
  )
})
