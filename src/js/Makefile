SOURCES =  \
	cloudeebus-connection.js \
	cloudeebus-service.js \
	cloudeebus-promise.js \
	cloudeebus-proxy.js 

DESTINATION = ../../cloudeebus

TARGET = $(DESTINATION)/cloudeebus.js

$(TARGET): $(SOURCES)
	cat $(SOURCES) > $(TARGET)

all: $(TARGET)

clean:
	rm $(TARGET)
