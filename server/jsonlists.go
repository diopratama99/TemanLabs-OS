package main

import (
	"encoding"
	"encoding/json"
	"reflect"
)

// Go writes an empty slice made with `var xs []T` as null, and the UI reads lists' length: a
// fresh server (no users, no shares, no apps yet) then breaks a window. withLists returns a copy
// of v in which every nil slice (but []byte) is an empty one, so every response sends [] instead.
func withLists(v any) any {
	if v == nil {
		return nil
	}
	rv := reflect.ValueOf(v)
	if !needsLists(rv.Type(), map[reflect.Type]bool{}) {
		return v
	}
	return listsIn(rv).Interface()
}

var (
	jsonMarshaler = reflect.TypeFor[json.Marshaler]()
	textMarshaler = reflect.TypeFor[encoding.TextMarshaler]()
)

// Types that write themselves are left alone, as are those with no slice anywhere inside.
func ownsJSON(t reflect.Type) bool {
	return t.Implements(jsonMarshaler) || t.Implements(textMarshaler) ||
		reflect.PointerTo(t).Implements(jsonMarshaler) || reflect.PointerTo(t).Implements(textMarshaler)
}

func needsLists(t reflect.Type, seen map[reflect.Type]bool) bool {
	if seen[t] {
		return false
	}
	seen[t] = true
	if ownsJSON(t) {
		return false
	}
	switch t.Kind() {
	case reflect.Slice:
		return t.Elem().Kind() != reflect.Uint8
	case reflect.Array, reflect.Pointer:
		return needsLists(t.Elem(), seen)
	case reflect.Map:
		return needsLists(t.Elem(), seen)
	case reflect.Interface:
		return true
	case reflect.Struct:
		for i := range t.NumField() {
			if f := t.Field(i); f.IsExported() && needsLists(f.Type, seen) {
				return true
			}
		}
	}
	return false
}

func listsIn(v reflect.Value) reflect.Value {
	if !v.IsValid() || ownsJSON(v.Type()) {
		return v
	}
	switch v.Kind() {
	case reflect.Interface:
		if v.IsNil() {
			return v
		}
		inner := listsIn(v.Elem())
		out := reflect.New(v.Type()).Elem()
		out.Set(inner)
		return out
	case reflect.Pointer:
		if v.IsNil() {
			return v
		}
		p := reflect.New(v.Type().Elem())
		p.Elem().Set(listsIn(v.Elem()))
		return p
	case reflect.Slice:
		if v.Type().Elem().Kind() == reflect.Uint8 {
			return v
		}
		if v.IsNil() {
			return reflect.MakeSlice(v.Type(), 0, 0)
		}
		out := reflect.MakeSlice(v.Type(), v.Len(), v.Len())
		for i := range v.Len() {
			out.Index(i).Set(listsIn(v.Index(i)))
		}
		return out
	case reflect.Array:
		out := reflect.New(v.Type()).Elem()
		for i := range v.Len() {
			out.Index(i).Set(listsIn(v.Index(i)))
		}
		return out
	case reflect.Map:
		if v.IsNil() {
			return v
		}
		out := reflect.MakeMapWithSize(v.Type(), v.Len())
		for it := v.MapRange(); it.Next(); {
			out.SetMapIndex(it.Key(), listsIn(it.Value()))
		}
		return out
	case reflect.Struct:
		out := reflect.New(v.Type()).Elem()
		out.Set(v)
		for i := range v.NumField() {
			if v.Type().Field(i).IsExported() {
				out.Field(i).Set(listsIn(v.Field(i)))
			}
		}
		return out
	}
	return v
}
